import {
  VISION_LIVE_MAX_DIMENSION,
  VISION_OCR_MIN_CONFIDENCE,
  VISION_PHOTO_MAX_DIMENSION,
} from '../../config/vision';
import type { OcrLineBox } from './ocrMessages';

const JAPANESE_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f]/;

export function containsJapanese(text: string): boolean {
  return JAPANESE_RE.test(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function computeCoverTransform(
  sourceWidth: number,
  sourceHeight: number,
  displayWidth: number,
  displayHeight: number,
): { scale: number; offsetX: number; offsetY: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0 || displayWidth <= 0 || displayHeight <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const displayAspect = displayWidth / displayHeight;

  if (sourceAspect > displayAspect) {
    const scale = displayHeight / sourceHeight;
    return {
      scale,
      offsetX: (displayWidth - sourceWidth * scale) / 2,
      offsetY: 0,
    };
  }

  const scale = displayWidth / sourceWidth;
  return {
    scale,
    offsetX: 0,
    offsetY: (displayHeight - sourceHeight * scale) / 2,
  };
}

export function assertValidImageDimensions(width: number, height: number): void {
  if (width <= 0 || height <= 0) {
    throw new Error('Image has no pixels. Wait for the camera to focus or choose another photo.');
  }
}

export function preprocessCanvas(source: HTMLCanvasElement, mode: 'photo' | 'live' = 'photo'): ImageData {
  const maxDim = mode === 'live' ? VISION_LIVE_MAX_DIMENSION : VISION_PHOTO_MAX_DIMENSION;
  let { width, height } = source;

  assertValidImageDimensions(width, height);
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas unavailable');

  ctx.drawImage(source, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const contrast = Math.min(255, Math.max(0, (gray - 128) * 1.35 + 128));
    data[i] = contrast;
    data[i + 1] = contrast;
    data[i + 2] = contrast;
  }

  ctx.putImageData(imageData, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}

export function captureVideoFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width <= 0 || height <= 0) {
    throw new Error('Camera frame not ready. Wait a moment and try again.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(video, 0, 0, width, height);
  return canvas;
}

export async function waitForVideoFrame(
  video: HTMLVideoElement,
  timeoutMs = 5000,
): Promise<HTMLCanvasElement> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return captureVideoFrame(video);
    }
    await sleep(50);
  }
  throw new Error('Camera frame not ready. Point the camera at text and wait a moment.');
}

export function filterOcrLines(lines: OcrLineBox[], minConfidence = VISION_OCR_MIN_CONFIDENCE): OcrLineBox[] {
  return lines.filter((line) => {
    const text = line.text.trim();
    if (!text || !containsJapanese(text)) return false;
    if (line.confidence > 0 && line.confidence < minConfidence) return false;
    return true;
  });
}

function lineOrientation(line: OcrLineBox): 'horizontal' | 'vertical' {
  const w = Math.max(1, line.bbox.x1 - line.bbox.x0);
  const h = Math.max(1, line.bbox.y1 - line.bbox.y0);
  if (h > w * 1.35 && line.text.length <= 6) return 'vertical';
  return 'horizontal';
}

function mergeHorizontalLines(lines: OcrLineBox[]): OcrLineBox[] {
  if (lines.length <= 1) return lines;
  const sorted = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const merged: OcrLineBox[] = [];
  for (const line of sorted) {
    const last = merged.at(-1);
    if (!last) {
      merged.push({ ...line });
      continue;
    }
    const verticalGap = line.bbox.y0 - last.bbox.y1;
    if (verticalGap < 12 && Math.abs(line.bbox.x0 - last.bbox.x0) < 40) {
      last.text = `${last.text} ${line.text}`.trim();
      last.confidence = (last.confidence + line.confidence) / 2;
      last.bbox = {
        x0: Math.min(last.bbox.x0, line.bbox.x0),
        y0: Math.min(last.bbox.y0, line.bbox.y0),
        x1: Math.max(last.bbox.x1, line.bbox.x1),
        y1: Math.max(last.bbox.y1, line.bbox.y1),
      };
      last.words = [...last.words, ...line.words];
    } else {
      merged.push({ ...line });
    }
  }
  return merged;
}

function mergeVerticalLines(lines: OcrLineBox[]): OcrLineBox[] {
  if (lines.length <= 1) return lines;
  const sorted = [...lines].sort((a, b) => a.bbox.x0 - b.bbox.x0 || a.bbox.y0 - b.bbox.y0);
  const merged: OcrLineBox[] = [];
  for (const line of sorted) {
    const last = merged.at(-1);
    if (!last) {
      merged.push({ ...line });
      continue;
    }
    const horizontalGap = line.bbox.x0 - last.bbox.x1;
    const verticalGap = line.bbox.y0 - last.bbox.y1;
    if (horizontalGap < 24 && verticalGap < 36) {
      last.text = `${last.text}${line.text}`.trim();
      last.confidence = (last.confidence + line.confidence) / 2;
      last.bbox = {
        x0: Math.min(last.bbox.x0, line.bbox.x0),
        y0: Math.min(last.bbox.y0, line.bbox.y0),
        x1: Math.max(last.bbox.x1, line.bbox.x1),
        y1: Math.max(last.bbox.y1, line.bbox.y1),
      };
      last.words = [...last.words, ...line.words];
    } else {
      merged.push({ ...line });
    }
  }
  return merged;
}

export function mergeAdjacentLines(lines: OcrLineBox[]): OcrLineBox[] {
  if (lines.length <= 1) return lines;
  const horizontal: OcrLineBox[] = [];
  const vertical: OcrLineBox[] = [];
  for (const line of lines) {
    if (lineOrientation(line) === 'vertical') {
      vertical.push(line);
    } else {
      horizontal.push(line);
    }
  }
  return [...mergeHorizontalLines(horizontal), ...mergeVerticalLines(vertical)];
}

export interface OverlayLabel {
  id: string;
  source: string;
  translation: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export function mapOverlayLabels(
  lines: OcrLineBox[],
  translations: Map<string, string>,
  sourceWidth: number,
  sourceHeight: number,
  displayWidth: number,
  displayHeight: number,
  useCoverTransform = true,
): OverlayLabel[] {
  const { scale, offsetX, offsetY } = useCoverTransform
    ? computeCoverTransform(sourceWidth, sourceHeight, displayWidth, displayHeight)
    : {
        scale: displayWidth / sourceWidth,
        offsetX: 0,
        offsetY: 0,
      };

  const mapCoord = (value: number, axis: 'x' | 'y'): number => {
    const offset = axis === 'x' ? offsetX : offsetY;
    return offset + value * scale;
  };

  return lines.map((line, index) => {
    const translation = translations.get(line.text.trim()) ?? '';
    return {
      id: `${line.bbox.x0}-${line.bbox.y0}-${index}`,
      source: line.text.trim(),
      translation,
      confidence: line.confidence,
      bbox: {
        x0: mapCoord(line.bbox.x0, 'x'),
        y0: mapCoord(line.bbox.y0, 'y'),
        x1: mapCoord(line.bbox.x1, 'x'),
        y1: mapCoord(line.bbox.y1, 'y'),
      },
    };
  });
}

export function wrapOverlayText(text: string, maxCharsPerLine = 28): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}
