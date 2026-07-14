import { VISION_OCR_MIN_CONFIDENCE, VISION_PHOTO_MAX_DIMENSION } from '../../config/vision';
import type { OcrLineBox } from './ocrMessages';

const JAPANESE_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f]/;

export function containsJapanese(text: string): boolean {
  return JAPANESE_RE.test(text);
}

export function preprocessCanvas(source: HTMLCanvasElement): ImageData {
  const maxDim = VISION_PHOTO_MAX_DIMENSION;
  let { width, height } = source;
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
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(video, 0, 0);
  return canvas;
}

export function filterOcrLines(lines: OcrLineBox[]): OcrLineBox[] {
  return lines.filter((line) => {
    const text = line.text.trim();
    if (!text || !containsJapanese(text)) return false;
    if (line.confidence < VISION_OCR_MIN_CONFIDENCE) return false;
    return true;
  });
}

export function mergeAdjacentLines(lines: OcrLineBox[]): OcrLineBox[] {
  if (lines.length <= 1) return lines;
  const sorted = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const merged: OcrLineBox[] = [];
  for (const line of sorted) {
    const last = merged.at(-1);
    if (!last) {
      merged.push(line);
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
      merged.push(line);
    }
  }
  return merged;
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
): OverlayLabel[] {
  const scaleX = displayWidth / sourceWidth;
  const scaleY = displayHeight / sourceHeight;

  return lines.map((line, index) => {
    const translation = translations.get(line.text.trim()) ?? '';
    return {
      id: `${line.bbox.x0}-${line.bbox.y0}-${index}`,
      source: line.text.trim(),
      translation,
      confidence: line.confidence,
      bbox: {
        x0: line.bbox.x0 * scaleX,
        y0: line.bbox.y0 * scaleY,
        x1: line.bbox.x1 * scaleX,
        y1: line.bbox.y1 * scaleY,
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
