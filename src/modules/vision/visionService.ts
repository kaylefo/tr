import type { PackComponentId, VisionTierId } from '../../config/vision';
import {
  COMPONENT_ESTIMATED_MB,
  getVisionTier,
  VISION_OCR_TEST_TEXT,
} from '../../config/vision';
import { translationService } from '../translation/translationService';
import { getJaEnPack } from '../storage/packStore';
import {
  allComponentsReady,
  getVisionPack,
  saveVisionPack,
  updateVisionComponent,
  type VisionPackRecord,
} from '../storage/visionPackStore';
import {
  OCR_MESSAGE,
  profileToLangs,
  profileToTessdata,
  type OcrInbound,
  type OcrLangProfile,
  type OcrOutbound,
  type OcrProgressPayload,
  type OcrResultPayload,
} from './ocrMessages';
import type { OcrLineBox } from './ocrMessages';
import {
  filterOcrLines,
  mergeAdjacentLines,
  type OverlayLabel,
  mapOverlayLabels,
} from './imageProcessing';

type ComponentProgressHandler = (pack: VisionPackRecord) => void;

function componentToOcrProfile(componentId: PackComponentId): OcrLangProfile | null {
  switch (componentId) {
    case 'ocr-jpn-fast':
      return 'jpn-fast';
    case 'ocr-jpn-best':
      return 'jpn-best';
    case 'ocr-jpn-vert':
      return 'jpn-vert';
    default:
      return null;
  }
}

export class VisionService {
  private ocrWorker: Worker | null = null;
  private ocrRequestId = 0;
  private latestOcrRequestId = 0;
  private activeTierId: VisionTierId | null = null;
  private translationCache = new Map<string, string>();

  private resolveOcr: ((result: OcrResultPayload) => void) | null = null;
  private rejectOcr: ((message: string) => void) | null = null;

  private ensureOcrWorker(): Worker {
    if (!this.ocrWorker) {
      this.ocrWorker = new Worker(new URL('../../workers/ocr.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.ocrWorker.addEventListener('message', (event: MessageEvent<OcrOutbound>) => {
        this.handleOcrMessage(event.data);
      });
    }
    return this.ocrWorker;
  }

  private postOcr(message: OcrInbound): void {
    this.ensureOcrWorker().postMessage(message);
  }

  private handleOcrMessage(message: OcrOutbound): void {
    switch (message.type) {
      case OCR_MESSAGE.RESULT:
        if (message.payload.requestId >= this.latestOcrRequestId) {
          this.resolveOcr?.(message.payload);
        }
        break;
      case OCR_MESSAGE.ERROR:
        if (
          message.payload.requestId === undefined ||
          message.payload.requestId >= this.latestOcrRequestId
        ) {
          this.rejectOcr?.(message.payload.message);
        }
        break;
      default:
        break;
    }
  }

  async downloadTier(tierId: VisionTierId, isOnline: boolean, onProgress: ComponentProgressHandler): Promise<VisionPackRecord> {
    if (!isOnline) {
      throw new Error('Connect to the internet to download vision language packs.');
    }

    await translationService.requestPersistentStorage();
    const tier = getVisionTier(tierId);
    let pack = await getVisionPack(tierId);
    pack = { ...pack, status: 'downloading', errorMessage: undefined };
    await saveVisionPack(pack);
    onProgress(pack);

    for (const componentId of tier.components) {
      pack = updateVisionComponent(pack, componentId, {
        status: 'downloading',
        progress: 0,
        errorMessage: undefined,
      });
      await saveVisionPack(pack);
      onProgress(pack);

      try {
        if (componentId === 'translation-ja-en') {
          await this.downloadTranslationComponent(pack, componentId, onProgress);
        } else {
          await this.downloadOcrComponent(tierId, componentId, onProgress);
        }
        pack = await getVisionPack(tierId);
        pack = updateVisionComponent(pack, componentId, {
          status: 'ready',
          progress: 100,
          totalBytes: COMPONENT_ESTIMATED_MB[componentId] * 1024 * 1024,
        });
        await saveVisionPack(pack);
        onProgress(pack);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Download failed';
        pack = await getVisionPack(tierId);
        pack = updateVisionComponent(pack, componentId, {
          status: 'failed',
          errorMessage: message,
        });
        pack = { ...pack, status: 'failed', errorMessage: message };
        await saveVisionPack(pack);
        onProgress(pack);
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
    onProgress(pack);
    return pack;
  }

  private async downloadTranslationComponent(
    pack: VisionPackRecord,
    componentId: PackComponentId,
    onProgress: ComponentProgressHandler,
  ): Promise<void> {
    const unsubscribe = translationService.subscribe({
      onProgress: (payload) => {
        void getVisionPack(pack.tierId).then(async (current) => {
          const updated = updateVisionComponent(current, componentId, {
            status: 'downloading',
            progress: payload.progress ?? current.components.find((c) => c.id === componentId)?.progress ?? 0,
          });
          await saveVisionPack(updated);
          onProgress(updated);
        });
      },
    });

    try {
      await translationService.downloadAndInitialize(true);

      const validation = await translationService.translate(VISION_OCR_TEST_TEXT, true);
      if (!validation.trim()) {
        throw new Error('Translation validation failed.');
      }
    } finally {
      unsubscribe();
    }
  }

  private async downloadOcrComponent(
    tierId: VisionTierId,
    componentId: PackComponentId,
    onProgress: ComponentProgressHandler,
  ): Promise<void> {
    const profile = componentToOcrProfile(componentId);
    if (!profile) throw new Error(`Unknown OCR component ${componentId}`);

    await new Promise<void>((resolve, reject) => {
      const handler = (event: MessageEvent<OcrOutbound>) => {
        const message = event.data;
        if (message.type === OCR_MESSAGE.PROGRESS) {
          void getVisionPack(tierId).then(async (current) => {
            const progress = message.payload.progress ?? 0;
            const updated = updateVisionComponent(current, componentId, {
              status: 'downloading',
              progress,
              loadedBytes: message.payload.loaded,
              totalBytes: message.payload.total,
            });
            await saveVisionPack(updated);
            onProgress(updated);
          });
        }
        if (message.type === OCR_MESSAGE.READY) {
          this.ocrWorker?.removeEventListener('message', handler);
          resolve();
        }
        if (message.type === OCR_MESSAGE.ERROR && !message.payload.requestId) {
          this.ocrWorker?.removeEventListener('message', handler);
          reject(new Error(message.payload.message));
        }
      };

      this.ensureOcrWorker().addEventListener('message', handler);
      this.postOcr({
        type: OCR_MESSAGE.INIT,
        payload: {
          langs: profileToLangs(profile),
          langProfile: profile,
          tessdataPath: profileToTessdata(profile),
        },
      });
    });
  }

  async ensureTierReady(tierId: VisionTierId, isOnline: boolean): Promise<VisionPackRecord> {
    const pack = await getVisionPack(tierId);
    if (pack.status === 'ready' && allComponentsReady(pack)) return pack;
    if (!isOnline) {
      throw new Error('Download the vision language pack while connected.');
    }
    throw new Error('Vision language pack is not ready.');
  }

  async recognizeImage(
    imageData: ImageData,
    tierId: VisionTierId,
    psm: number,
  ): Promise<OcrLineBox[]> {
    await this.initOcrForTier(tierId);

    const requestId = ++this.ocrRequestId;
    this.latestOcrRequestId = requestId;

    const result = await new Promise<OcrResultPayload>((resolve, reject) => {
      this.resolveOcr = resolve;
      this.rejectOcr = reject;
      this.postOcr({
        type: OCR_MESSAGE.RECOGNIZE,
        payload: { requestId, imageData, psm },
      });
    });

    return mergeAdjacentLines(filterOcrLines(result.lines));
  }

  async translateLines(lines: OcrLineBox[], isOnline: boolean): Promise<Map<string, string>> {
    const unique = [...new Set(lines.map((l) => l.text.trim()).filter(Boolean))];
    const map = new Map<string, string>();

    for (const source of unique) {
      const cached = this.translationCache.get(source);
      if (cached) {
        map.set(source, cached);
        continue;
      }
      const translation = await translationService.translate(source, isOnline);
      this.translationCache.set(source, translation);
      map.set(source, translation);
    }

    return map;
  }

  async processImageToOverlays(
    imageData: ImageData,
    tierId: VisionTierId,
    psm: number,
    displayWidth: number,
    displayHeight: number,
    isOnline: boolean,
  ): Promise<OverlayLabel[]> {
    const lines = await this.recognizeImage(imageData, tierId, psm);
    const translations = await this.translateLines(lines, isOnline);
    return mapOverlayLabels(
      lines,
      translations,
      imageData.width,
      imageData.height,
      displayWidth,
      displayHeight,
    );
  }

  private async initOcrForTier(tierId: VisionTierId): Promise<void> {
    if (this.activeTierId === tierId) return;
    const pack = await getVisionPack(tierId);
    if (pack.status !== 'ready') {
      throw new Error('Vision pack not ready.');
    }

    const ocrComponent = pack.components.find((c) => c.id.startsWith('ocr-'));
    if (!ocrComponent) throw new Error('OCR component missing');

    const profile = componentToOcrProfile(ocrComponent.id);
    if (!profile) throw new Error('Invalid OCR component');

    if (pack.components.some((c) => c.id === 'ocr-jpn-vert' && c.status === 'ready')) {
      await this.initOcrProfile('jpn-vert');
    } else {
      await this.initOcrProfile(profile);
    }

    this.activeTierId = tierId;
  }

  private async initOcrProfile(profile: OcrLangProfile): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const handler = (event: MessageEvent<OcrOutbound>) => {
        const message = event.data;
        if (message.type === OCR_MESSAGE.READY) {
          this.ocrWorker?.removeEventListener('message', handler);
          resolve();
        }
        if (message.type === OCR_MESSAGE.ERROR && !message.payload.requestId) {
          this.ocrWorker?.removeEventListener('message', handler);
          reject(new Error(message.payload.message));
        }
      };
      this.ensureOcrWorker().addEventListener('message', handler);
      this.postOcr({
        type: OCR_MESSAGE.INIT,
        payload: {
          langs: profileToLangs(profile),
          langProfile: profile,
          tessdataPath: profileToTessdata(profile),
        },
      });
    });
  }

  clearTranslationCache(): void {
    this.translationCache.clear();
  }

  async deleteTier(tierId: VisionTierId): Promise<void> {
    const pack = await getVisionPack(tierId);
    if (pack.components.some((c) => c.id === 'translation-ja-en' && c.status === 'ready')) {
      const otherReady = (await Promise.all(
        (['essential', 'standard', 'live'] as VisionTierId[])
          .filter((id) => id !== tierId)
          .map((id) => getVisionPack(id)),
      )).some(
        (p) => p.status === 'ready' && p.components.some((c) => c.id === 'translation-ja-en' && c.status === 'ready'),
      );
      if (!otherReady) {
        await translationService.deletePack();
      }
    }

    this.postOcr({ type: OCR_MESSAGE.DISPOSE });
    this.ocrWorker?.terminate();
    this.ocrWorker = null;
    this.activeTierId = null;

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

  async isTranslationReady(): Promise<boolean> {
    const pack = await getJaEnPack();
    return pack.status === 'ready';
  }
}

export const visionService = new VisionService();

export type { OcrProgressPayload };
