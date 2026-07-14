import type { VisionMode, VisionTierId } from '../../config/vision';
import { languagePackManager } from '../languagePack/languagePackManager';
import { translationService } from '../translation/translationService';
import { ocrService } from './ocrService';
import { getJaEnPack } from '../storage/packStore';
import {
  getActiveVisionPack,
  getActiveVisionPackForMode,
  isVisionPackOperational,
  listVisionPacks,
  pendingVisionComponents,
  repairVisionPack,
  type VisionPackRecord,
} from '../storage/visionPackStore';
import type { OcrLangProfile, OcrLineBox, OcrProgressPayload } from './ocrMessages';
import type { PackComponentId } from '../../config/vision';
import type { OverlayLabel } from './imageProcessing';
import { mapOverlayLabels } from './imageProcessing';
import { runVisionPipeline } from './visionPipeline';

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

function formatNotReadyMessage(pack: VisionPackRecord): string {
  const pending = pendingVisionComponents(pack);
  if (pending.length === 0) {
    return 'Vision language pack is not ready. Open Language packs and tap Repair / redownload.';
  }
  const names = pending.map((c) => c.label).join(', ');
  return `Vision language pack is not ready (${names}). Open Language packs and tap Repair / redownload.`;
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

  async repairTier(tierId: VisionTierId): Promise<VisionPackRecord> {
    return languagePackManager.repairTier(tierId);
  }

  async ensureTierReady(tierId: VisionTierId, isOnline: boolean): Promise<VisionPackRecord> {
    const pack = await repairVisionPack(tierId);

    if (isVisionPackOperational(pack)) {
      return pack;
    }

    if (!isOnline) {
      throw new Error('Download the vision language pack while connected.');
    }

    throw new Error(formatNotReadyMessage(pack));
  }

  async warmUp(tierId: VisionTierId): Promise<void> {
    if (this.warmPromise) return this.warmPromise;

    this.warmPromise = (async () => {
      const pack = await repairVisionPack(tierId);
      if (!isVisionPackOperational(pack)) return;
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
    _mode: VisionMode = 'photo',
  ): Promise<OcrLineBox[]> {
    await this.initOcrForTier(tierId);
    const result = await ocrService.recognize(imageData, psm);
    return result.lines;
  }

  async translateLine(text: string, isOnline: boolean): Promise<string> {
    const cached = this.translationCache.get(text);
    if (cached) return cached;

    const translation = await translationService.translate(text, isOnline);
    this.translationCache.set(text, translation);
    return translation;
  }

  async processFrameToOverlays(
    canvas: HTMLCanvasElement,
    tierId: VisionTierId,
    _psm: number,
    mode: VisionMode,
    displayWidth: number,
    displayHeight: number,
    isOnline: boolean,
  ): Promise<OverlayLabel[]> {
    const result = await runVisionPipeline(
      {
        canvas,
        tierId,
        mode,
        displayWidth,
        displayHeight,
        isOnline,
      },
      {
        ensureTierReady: (id, online) => this.ensureTierReady(id, online),
        warmUp: (id) => this.warmUp(id),
        recognize: (imageData, id, psm, visionMode) =>
          this.recognizeImage(imageData, id, psm, visionMode),
        translateLine: (text, online) => this.translateLine(text, online),
      },
    );

    return result.overlays;
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
    await this.ensureTierReady(tierId, isOnline);
    await this.warmUp(tierId);
    const lines = await this.recognizeImage(imageData, tierId, psm, mode);
    const translations = new Map<string, string>();
    for (const line of lines) {
      const source = line.text.trim();
      if (!source) continue;
      translations.set(source, await this.translateLine(source, isOnline));
    }
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
    const pack = await repairVisionPack(tierId);
    if (!isVisionPackOperational(pack)) {
      throw new Error(formatNotReadyMessage(pack));
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

  async getActivePackForMode(mode: VisionMode): Promise<VisionPackRecord | null> {
    return getActiveVisionPackForMode(mode);
  }
}

export const visionService = new VisionService();

export type { OcrProgressPayload };
