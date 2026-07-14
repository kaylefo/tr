import type { VisionMode, VisionTierId } from '../../config/vision';
import { VISION_LIVE_MIN_CONFIDENCE } from '../../config/vision';
import { languagePackManager } from '../languagePack/languagePackManager';
import { translationService } from '../translation/translationService';
import { ocrService } from './ocrService';
import { getJaEnPack } from '../storage/packStore';
import {
  allComponentsReady,
  getActiveVisionPack,
  getVisionPack,
  listVisionPacks,
  type VisionPackRecord,
} from '../storage/visionPackStore';
import type { OcrLangProfile, OcrLineBox, OcrProgressPayload } from './ocrMessages';
import type { PackComponentId } from '../../config/vision';
import {
  filterOcrLines,
  mergeAdjacentLines,
  preprocessCanvas,
  type OverlayLabel,
  mapOverlayLabels,
} from './imageProcessing';

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
  private activeTierId: VisionTierId | null = null;
  private activeOcrProfile: OcrLangProfile | null = null;
  private translationCache = new Map<string, string>();
  private warmPromise: Promise<void> | null = null;

  async downloadTier(
    tierId: VisionTierId,
    isOnline: boolean,
    onProgress: (pack: VisionPackRecord) => void,
  ): Promise<VisionPackRecord> {
    return languagePackManager.downloadVisionTier(tierId, isOnline, onProgress);
  }

  async ensureTierReady(tierId: VisionTierId, isOnline: boolean): Promise<VisionPackRecord> {
    const pack = await getVisionPack(tierId);
    if (pack.status === 'ready' && allComponentsReady(pack)) return pack;
    if (!isOnline) {
      throw new Error('Download the vision language pack while connected.');
    }
    throw new Error('Vision language pack is not ready.');
  }

  async warmUp(tierId: VisionTierId): Promise<void> {
    if (this.warmPromise) return this.warmPromise;

    this.warmPromise = (async () => {
      const pack = await getVisionPack(tierId);
      if (pack.status !== 'ready') return;
      await translationService.ensureReady();
      await this.initOcrForTier(tierId);
    })().finally(() => {
      this.warmPromise = null;
    });

    return this.warmPromise;
  }

  async recognizeImage(
    imageData: ImageData,
    tierId: VisionTierId,
    psm: number,
    mode: VisionMode = 'photo',
  ): Promise<OcrLineBox[]> {
    await this.initOcrForTier(tierId);
    const result = await ocrService.recognize(imageData, psm);
    const minConfidence = mode === 'live' ? VISION_LIVE_MIN_CONFIDENCE : undefined;
    return mergeAdjacentLines(filterOcrLines(result.lines, minConfidence));
  }

  async translateLines(lines: OcrLineBox[], isOnline: boolean): Promise<Map<string, string>> {
    const unique = [...new Set(lines.map((l) => l.text.trim()).filter(Boolean))];
    const map = new Map<string, string>();

    await Promise.all(
      unique.map(async (source) => {
        const cached = this.translationCache.get(source);
        if (cached) {
          map.set(source, cached);
          return;
        }
        const translation = await translationService.translate(source, isOnline);
        this.translationCache.set(source, translation);
        map.set(source, translation);
      }),
    );

    return map;
  }

  async processFrameToOverlays(
    canvas: HTMLCanvasElement,
    tierId: VisionTierId,
    psm: number,
    mode: VisionMode,
    displayWidth: number,
    displayHeight: number,
    isOnline: boolean,
  ): Promise<OverlayLabel[]> {
    await this.warmUp(tierId);
    const imageData = preprocessCanvas(canvas, mode);
    const lines = await this.recognizeImage(imageData, tierId, psm, mode);
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

  async processImageToOverlays(
    imageData: ImageData,
    tierId: VisionTierId,
    psm: number,
    displayWidth: number,
    displayHeight: number,
    isOnline: boolean,
    mode: VisionMode = 'photo',
  ): Promise<OverlayLabel[]> {
    const lines = await this.recognizeImage(imageData, tierId, psm, mode);
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
    const pack = await getVisionPack(tierId);
    if (pack.status !== 'ready') {
      throw new Error('Vision pack not ready.');
    }

    const ocrComponent = pack.components.find((c) => c.id.startsWith('ocr-') && c.status === 'ready');
    if (!ocrComponent) throw new Error('OCR component missing');

    let profile = componentToOcrProfile(ocrComponent.id);
    if (pack.components.some((c) => c.id === 'ocr-jpn-vert' && c.status === 'ready')) {
      profile = 'jpn-vert';
    }
    if (!profile) throw new Error('Invalid OCR component');

    if (this.activeTierId === tierId && this.activeOcrProfile === profile) return;

    await ocrService.ensureProfile(profile);
    this.activeTierId = tierId;
    this.activeOcrProfile = profile;
  }

  clearTranslationCache(): void {
    this.translationCache.clear();
  }

  async deleteTier(tierId: VisionTierId): Promise<void> {
    await languagePackManager.deleteVisionTier(tierId);
    if (this.activeTierId === tierId) {
      this.activeTierId = null;
      this.activeOcrProfile = null;
    }
  }

  async isTranslationReady(): Promise<boolean> {
    const pack = await getJaEnPack();
    return pack.status === 'ready';
  }

  async listPacks(): Promise<VisionPackRecord[]> {
    return listVisionPacks();
  }

  async getActivePack(): Promise<VisionPackRecord | null> {
    return getActiveVisionPack();
  }
}

export const visionService = new VisionService();

export type { OcrProgressPayload };
