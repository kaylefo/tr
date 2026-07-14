import type { PackComponentId, VisionTierId } from '../../config/vision';
import {
  COMPONENT_ESTIMATED_MB,
  getVisionTier,
  VISION_TIERS,
} from '../../config/vision';
import { getJaEnPack, type OfflinePackRecord } from '../storage/packStore';
import {
  allComponentsReady,
  getVisionPack,
  listVisionPacks,
  repairVisionPack,
  saveVisionPack,
  updateVisionComponent,
  type VisionPackRecord,
} from '../storage/visionPackStore';
import type { OcrProgressPayload } from '../vision/ocrMessages';
import { ocrService } from '../vision/ocrService';
import { translationService } from '../translation/translationService';
import type { WorkerProgressPayload, WorkerReadyPayload } from '../translation/messages';
import { normalizeDownloadProgress, type NormalizedProgress } from './progress';
import { Subscribable } from './subscribable';

export type TranslationProgressHandler = (progress: NormalizedProgress, pack: OfflinePackRecord) => void;
export type VisionProgressHandler = (pack: VisionPackRecord) => void;

class LanguagePackManager {
  readonly translationProgress = new Subscribable<{
    progress: NormalizedProgress;
    pack: OfflinePackRecord;
  }>();
  readonly translationReady = new Subscribable<OfflinePackRecord>();
  readonly translationError = new Subscribable<{ pack: OfflinePackRecord; message: string }>();
  readonly visionProgress = new Subscribable<VisionPackRecord>();

  private visionDownloadChain: Promise<void> = Promise.resolve();

  async getTranslationPack(): Promise<OfflinePackRecord> {
    return getJaEnPack();
  }

  async isTranslationReady(): Promise<boolean> {
    const pack = await getJaEnPack();
    return pack.status === 'ready';
  }

  async downloadTranslationPack(
    isOnline: boolean,
    onProgress?: TranslationProgressHandler,
  ): Promise<OfflinePackRecord> {
    if (!isOnline) {
      throw new Error('Download the offline translation pack while connected.');
    }

    const unsubscribe = onProgress
      ? this.translationProgress.subscribe(({ progress, pack }) => onProgress(progress, pack))
      : undefined;

    try {
      const pack = await translationService.downloadAndInitialize(isOnline);
      await this.syncTranslationIntoVisionPacks(pack);
      return pack;
    } finally {
      unsubscribe?.();
    }
  }

  async deleteTranslationPack(): Promise<void> {
    await translationService.deletePack();
    await this.resetTranslationInVisionPacks();
  }

  async repairTier(tierId: VisionTierId): Promise<VisionPackRecord> {
    return repairVisionPack(tierId);
  }

  downloadVisionTier(
    tierId: VisionTierId,
    isOnline: boolean,
    onProgress?: VisionProgressHandler,
  ): Promise<VisionPackRecord> {
    if (!isOnline) {
      return Promise.reject(new Error('Connect to the internet to download vision language packs.'));
    }

    const run = async (): Promise<VisionPackRecord> => {
      const tier = getVisionTier(tierId);
      let pack = await getVisionPack(tierId);
      pack = { ...pack, status: 'downloading', errorMessage: undefined };
      await saveVisionPack(pack);
      this.emitVision(pack, onProgress);

      for (const componentId of tier.components) {
        pack = await getVisionPack(tierId);
        pack = updateVisionComponent(pack, componentId, {
          status: 'downloading',
          progress: 0,
          errorMessage: undefined,
        });
        await saveVisionPack(pack);
        this.emitVision(pack, onProgress);

        try {
          if (componentId === 'translation-ja-en') {
            await this.downloadVisionTranslationComponent(tierId, componentId, onProgress);
          } else {
            await ocrService.downloadComponent(componentId, (progress) => {
              void this.updateVisionOcrProgress(tierId, componentId, progress, onProgress);
            });
          }

          pack = await getVisionPack(tierId);
          pack = updateVisionComponent(pack, componentId, {
            status: 'ready',
            progress: 100,
            totalBytes: COMPONENT_ESTIMATED_MB[componentId] * 1024 * 1024,
            errorMessage: undefined,
          });
          await saveVisionPack(pack);
          this.emitVision(pack, onProgress);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Download failed';
          pack = await getVisionPack(tierId);
          pack = updateVisionComponent(pack, componentId, {
            status: 'failed',
            errorMessage: message,
          });
          pack = { ...pack, status: 'failed', errorMessage: message };
          await saveVisionPack(pack);
          this.emitVision(pack, onProgress);
          throw new Error(message);
        }
      }

      pack = await getVisionPack(tierId);
      if (!allComponentsReady(pack)) {
        throw new Error('Vision pack components did not all become ready.');
      }

      pack = {
        ...pack,
        status: 'ready',
        lastValidatedAt: Date.now(),
        errorMessage: undefined,
      };
      await saveVisionPack(pack);
      this.emitVision(pack, onProgress);
      return pack;
    };

    const promise = this.visionDownloadChain.then(run, run);
    this.visionDownloadChain = promise.then(
      () => undefined,
      () => undefined,
    );
    return promise;
  }

  async deleteVisionTier(tierId: VisionTierId): Promise<void> {
    const pack = await getVisionPack(tierId);
    const translationReadyHere = pack.components.some(
      (c) => c.id === 'translation-ja-en' && c.status === 'ready',
    );

    if (translationReadyHere) {
      const otherReady = (await listVisionPacks()).some(
        (p) =>
          p.tierId !== tierId &&
          p.status === 'ready' &&
          p.components.some((c) => c.id === 'translation-ja-en' && c.status === 'ready'),
      );
      if (!otherReady) {
        await translationService.deletePack();
      }
    }

    await ocrService.dispose();

    const reset = await getVisionPack(tierId);
    await saveVisionPack({
      ...reset,
      status: 'not_downloaded',
      lastValidatedAt: undefined,
      errorMessage: undefined,
      components: reset.components.map((c) => ({
        ...c,
        status: 'pending',
        progress: 0,
        loadedBytes: undefined,
        totalBytes: undefined,
        errorMessage: undefined,
      })),
    });
  }

  subscribeTranslationProgress(
    listener: (progress: NormalizedProgress, pack: OfflinePackRecord) => void,
  ): () => void {
    return this.translationProgress.subscribe(({ progress, pack }) => listener(progress, pack));
  }

  subscribeTranslationReady(listener: (pack: OfflinePackRecord) => void): () => void {
    return this.translationReady.subscribe(listener);
  }

  subscribeTranslationError(listener: (message: string, pack: OfflinePackRecord) => void): () => void {
    return this.translationError.subscribe(({ message, pack }) => listener(message, pack));
  }

  private async downloadVisionTranslationComponent(
    tierId: VisionTierId,
    componentId: PackComponentId,
    onProgress?: VisionProgressHandler,
  ): Promise<void> {
    const unsubscribe = translationService.subscribeProgress((payload) => {
      void this.updateVisionComponentProgress(tierId, componentId, payload, onProgress);
    });

    try {
      const pack = await translationService.downloadAndInitialize(true);
      await this.syncTranslationIntoVisionPacks(pack);

      const visionPack = await getVisionPack(tierId);
      const updated = updateVisionComponent(visionPack, componentId, {
        status: 'ready',
        progress: 100,
        errorMessage: undefined,
      });
      await saveVisionPack(updated);
      this.emitVision(updated, onProgress);
    } finally {
      unsubscribe();
    }
  }

  private async updateVisionOcrProgress(
    tierId: VisionTierId,
    componentId: PackComponentId,
    payload: OcrProgressPayload,
    onProgress?: VisionProgressHandler,
  ): Promise<void> {
    const current = await getVisionPack(tierId);
    const updated = updateVisionComponent(current, componentId, {
      status: payload.status === 'initializing' ? 'preparing' : 'downloading',
      progress: Math.max(
        payload.progress ?? 0,
        current.components.find((c) => c.id === componentId)?.progress ?? 0,
      ),
      loadedBytes: payload.loaded,
      totalBytes: payload.total,
      errorMessage: undefined,
    });
    await saveVisionPack(updated);
    this.emitVision(updated, onProgress);
  }

  private async updateVisionComponentProgress(
    tierId: VisionTierId,
    componentId: PackComponentId,
    payload: WorkerProgressPayload,
    onProgress?: VisionProgressHandler,
  ): Promise<void> {
    const normalized = normalizeDownloadProgress(payload);
    const current = await getVisionPack(tierId);
    const updated = updateVisionComponent(current, componentId, {
      status: normalized.status === 'preparing' ? 'preparing' : 'downloading',
      progress: normalized.progress,
      loadedBytes: normalized.loaded,
      totalBytes: normalized.total,
    });
    await saveVisionPack(updated);
    this.emitVision(updated, onProgress);
  }

  private async syncTranslationIntoVisionPacks(pack: OfflinePackRecord): Promise<void> {
    if (pack.status !== 'ready') return;

    for (const tier of VISION_TIERS) {
      if (!tier.components.includes('translation-ja-en')) continue;
      const visionPack = await getVisionPack(tier.tierId);
      const updated = updateVisionComponent(visionPack, 'translation-ja-en', {
        status: 'ready',
        progress: 100,
        errorMessage: undefined,
      });
      await saveVisionPack(updated);
    }
  }

  private async resetTranslationInVisionPacks(): Promise<void> {
    for (const tier of VISION_TIERS) {
      const visionPack = await getVisionPack(tier.tierId);
      const updated = updateVisionComponent(visionPack, 'translation-ja-en', {
        status: 'pending',
        progress: 0,
        loadedBytes: undefined,
        totalBytes: undefined,
        errorMessage: undefined,
      });
      await saveVisionPack(updated);
    }
  }

  private emitVision(pack: VisionPackRecord, onProgress?: VisionProgressHandler): void {
    this.visionProgress.emit(pack);
    onProgress?.(pack);
  }

  /** Bridge translation service events into manager-level subscriptions. */
  bindTranslationService(): void {
    translationService.subscribeProgress((payload, pack) => {
      this.translationProgress.emit({
        progress: normalizeDownloadProgress(payload),
        pack,
      });
    });
    translationService.subscribeReady((_payload, pack) => {
      void this.syncTranslationIntoVisionPacks(pack).then(() => {
        this.translationReady.emit(pack);
      });
    });
    translationService.subscribeError((message, pack) => {
      this.translationError.emit({ message, pack });
    });
  }
}

export const languagePackManager = new LanguagePackManager();
languagePackManager.bindTranslationService();

export type { WorkerReadyPayload };
