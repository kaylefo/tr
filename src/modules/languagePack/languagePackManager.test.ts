import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultJaEnPack } from '../storage/packStore';
import {
  createDefaultVisionPack,
  getVisionPack,
  saveVisionPack,
} from '../storage/visionPackStore';
import { LanguagePackManager } from './languagePackManager';

const { downloadTranslation } = vi.hoisted(() => ({
  downloadTranslation: vi.fn(),
}));

vi.mock('../translation/translationService', () => ({
  translationService: {
    downloadAndInitialize: downloadTranslation,
    deletePack: vi.fn(async () => undefined),
    subscribeProgress: vi.fn(() => () => undefined),
    subscribeReady: vi.fn(() => () => undefined),
    subscribeError: vi.fn(() => () => undefined),
  },
}));

vi.mock('../vision/ocrService', () => ({
  ocrService: {
    downloadComponent: vi.fn(
      async (
        _componentId: string,
        onProgress: (payload: { status: string; progress: number }) => void,
      ) => {
        onProgress({ status: 'loading language traineddata', progress: 50 });
        onProgress({ status: 'OCR ready', progress: 100 });
      },
    ),
  },
}));

describe('LanguagePackManager vision lifecycle', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    downloadTranslation.mockResolvedValue({
      ...defaultJaEnPack,
      status: 'ready',
      executionMode: 'wasm',
      lastValidatedAt: Date.now(),
    });
    for (const tierId of ['essential', 'standard', 'live'] as const) {
      await saveVisionPack(createDefaultVisionPack(tierId));
    }
  });

  it('coalesces duplicate downloads and reaches a fully ready state', async () => {
    const manager = new LanguagePackManager();
    const first = manager.downloadVisionTier('essential', true);
    const second = manager.downloadVisionTier('essential', true);

    expect(second).toBe(first);
    const pack = await first;
    expect(pack.status).toBe('ready');
    expect(pack.components.every((component) => component.status === 'ready')).toBe(
      true,
    );
    expect(manager.isBusy()).toBe(false);
    expect(downloadTranslation).toHaveBeenCalledTimes(1);
  });

  it('does not mark untouched tiers partially installed', async () => {
    const manager = new LanguagePackManager();
    await manager.downloadTranslationPack(true);

    expect((await getVisionPack('standard')).status).toBe('not_downloaded');
    expect((await getVisionPack('live')).status).toBe('not_downloaded');
  });

  it('resets only the deleted tier', async () => {
    const manager = new LanguagePackManager();
    await manager.downloadVisionTier('essential', true);
    await manager.downloadVisionTier('live', true);
    await manager.deleteVisionTier('essential');

    expect((await getVisionPack('essential')).status).toBe('not_downloaded');
    expect((await getVisionPack('live')).status).toBe('ready');
  });
});
