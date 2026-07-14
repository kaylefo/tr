import type { VisionMode, VisionTierId } from '../../config/vision';
import { getVisionTier, VISION_LIVE_MIN_CONFIDENCE } from '../../config/vision';
import {
  VISION_OCR_RECOGNIZE_TIMEOUT_MS,
  VISION_TRANSLATE_LINE_TIMEOUT_MS,
} from '../../config/languagePack';
import type { VisionPackRecord } from '../storage/visionPackStore';
import {
  filterOcrLines,
  mapOverlayLabels,
  mergeAdjacentLines,
  preprocessCanvas,
  type OverlayLabel,
} from './imageProcessing';
import type { OcrLineBox } from './ocrMessages';

export type VisionStage = 'pack' | 'preprocess' | 'ocr' | 'translate' | 'overlay';

export class VisionPipelineError extends Error {
  readonly stage: VisionStage;

  constructor(stage: VisionStage, message: string, cause?: unknown) {
    super(message);
    this.name = 'VisionPipelineError';
    this.stage = stage;
    if (cause instanceof Error && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

export function formatVisionStageError(stage: VisionStage, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  switch (stage) {
    case 'pack':
      return detail;
    case 'preprocess':
      return detail;
    case 'ocr':
      return detail.startsWith('Text recognition')
        ? detail
        : `Text recognition failed: ${detail}`;
    case 'translate':
      return detail.startsWith('Translation')
        ? detail
        : `Translation failed: ${detail}`;
    default:
      return detail || 'Vision processing failed';
  }
}

export function isVisionPipelineError(err: unknown): err is VisionPipelineError {
  return err instanceof VisionPipelineError;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function runStage<T>(
  stage: VisionStage,
  fn: () => Promise<T>,
  fallbackMessage: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isVisionPipelineError(err)) throw err;
    const detail = err instanceof Error ? err.message : fallbackMessage;
    throw new VisionPipelineError(stage, formatVisionStageError(stage, detail), err);
  }
}

export interface VisionPipelineDeps {
  ensureTierReady: (tierId: VisionTierId, isOnline: boolean) => Promise<VisionPackRecord>;
  warmUp: (tierId: VisionTierId) => Promise<void>;
  recognize: (
    imageData: ImageData,
    tierId: VisionTierId,
    psm: number,
    mode: VisionMode,
  ) => Promise<OcrLineBox[]>;
  translateLine: (text: string, isOnline: boolean) => Promise<string>;
}

export interface VisionPipelineInput {
  canvas: HTMLCanvasElement;
  tierId: VisionTierId;
  mode: VisionMode;
  displayWidth: number;
  displayHeight: number;
  isOnline: boolean;
}

export interface VisionPipelineResult {
  overlays: OverlayLabel[];
  detectedLines: number;
}

export async function runVisionPipeline(
  input: VisionPipelineInput,
  deps: VisionPipelineDeps,
): Promise<VisionPipelineResult> {
  const { canvas, tierId, mode, displayWidth, displayHeight, isOnline } = input;
  const tier = getVisionTier(tierId);

  await runStage('pack', () => deps.ensureTierReady(tierId, isOnline), 'Vision pack not ready');
  await runStage('pack', () => deps.warmUp(tierId), 'Failed to load vision models');

  const imageData = await runStage(
    'preprocess',
    async () => preprocessCanvas(canvas, mode),
    'Could not prepare image for recognition',
  );

  const lines = await runStage(
    'ocr',
    () =>
      withTimeout(
        deps.recognize(imageData, tierId, tier.ocrPsm, mode),
        VISION_OCR_RECOGNIZE_TIMEOUT_MS,
        'Text recognition timed out. Try Photo mode or move closer to the text.',
      ),
    'Text recognition failed',
  );

  const minConfidence = mode === 'live' ? VISION_LIVE_MIN_CONFIDENCE : undefined;
  const filtered = mergeAdjacentLines(filterOcrLines(lines, minConfidence));

  const translations = await runStage(
    'translate',
    () => translateUniqueLines(filtered, isOnline, deps.translateLine),
    'Translation failed',
  );

  const overlays = await runStage(
    'overlay',
    async () =>
      mapOverlayLabels(
        filtered,
        translations,
        imageData.width,
        imageData.height,
        displayWidth,
        displayHeight,
      ),
    'Could not build translation overlays',
  );

  return { overlays, detectedLines: filtered.length };
}

async function translateUniqueLines(
  lines: OcrLineBox[],
  isOnline: boolean,
  translateLine: (text: string, isOnline: boolean) => Promise<string>,
): Promise<Map<string, string>> {
  const unique = [...new Set(lines.map((l) => l.text.trim()).filter(Boolean))];
  const map = new Map<string, string>();

  await Promise.all(
    unique.map(async (source) => {
      const translation = await withTimeout(
        translateLine(source, isOnline),
        VISION_TRANSLATE_LINE_TIMEOUT_MS,
        'Translation timed out. Check that the language pack is ready.',
      );
      map.set(source, translation);
    }),
  );

  return map;
}
