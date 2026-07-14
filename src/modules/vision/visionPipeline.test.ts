import { describe, expect, it, vi } from 'vitest';
import { computeCoverTransform, mapOverlayLabels } from './imageProcessing';
import type { OcrLineBox } from './ocrMessages';
import {
  formatVisionStageError,
  runVisionPipeline,
} from './visionPipeline';

vi.mock('./imageProcessing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./imageProcessing')>();
  return {
    ...actual,
    preprocessCanvas: vi.fn(() => ({ width: 640, height: 480 }) as ImageData),
  };
});

describe('computeCoverTransform', () => {
  it('letterboxes a wide source on a tall display', () => {
    const transform = computeCoverTransform(1920, 1080, 300, 400);
    expect(transform.scale).toBeCloseTo(400 / 1080);
    expect(transform.offsetX).toBeLessThan(0);
    expect(transform.offsetY).toBe(0);
  });

  it('letterboxes a tall source on a wide display', () => {
    const transform = computeCoverTransform(1080, 1920, 400, 300);
    expect(transform.scale).toBeCloseTo(400 / 1080);
    expect(transform.offsetX).toBe(0);
    expect(transform.offsetY).toBeLessThan(0);
  });
});

describe('mapOverlayLabels cover mapping', () => {
  it('maps bbox through object-fit cover transform', () => {
    const lines: OcrLineBox[] = [
      {
        text: 'こんにちは',
        confidence: 90,
        bbox: { x0: 100, y0: 50, x1: 300, y1: 90 },
        words: [],
      },
    ];
    const translations = new Map([['こんにちは', 'Hello']]);
    const labels = mapOverlayLabels(lines, translations, 960, 540, 300, 400);
    expect(labels[0].translation).toBe('Hello');
    expect(labels[0].bbox.x0).not.toBe(100);
    expect(labels[0].bbox.y0).toBeGreaterThanOrEqual(0);
  });
});

describe('formatVisionStageError', () => {
  it('prefixes OCR failures', () => {
    expect(formatVisionStageError('ocr', new Error('worker crashed'))).toContain(
      'Text recognition failed',
    );
  });

  it('passes through pack errors unchanged', () => {
    expect(formatVisionStageError('pack', new Error('Pack missing'))).toBe('Pack missing');
  });
});

describe('runVisionPipeline', () => {
  it('returns overlays when all stages succeed', async () => {
    const canvas = { width: 640, height: 480 } as HTMLCanvasElement;

    const result = await runVisionPipeline(
      {
        canvas,
        tierId: 'live',
        mode: 'live',
        displayWidth: 320,
        displayHeight: 400,
        isOnline: true,
      },
      {
        ensureTierReady: vi.fn().mockResolvedValue({ tierId: 'live' }),
        warmUp: vi.fn().mockResolvedValue(undefined),
        recognize: vi.fn().mockResolvedValue([
          {
            text: '出口',
            confidence: 90,
            bbox: { x0: 10, y0: 10, x1: 80, y1: 40 },
            words: [],
          },
        ]),
        translateLine: vi.fn().mockResolvedValue('Exit'),
      },
    );

    expect(result.detectedLines).toBe(1);
    expect(result.overlays[0].translation).toBe('Exit');
  });

  it('throws VisionPipelineError when OCR fails', async () => {
    const canvas = { width: 640, height: 480 } as HTMLCanvasElement;

    await expect(
      runVisionPipeline(
        {
          canvas,
          tierId: 'live',
          mode: 'photo',
          displayWidth: 320,
          displayHeight: 400,
          isOnline: true,
        },
        {
          ensureTierReady: vi.fn().mockResolvedValue({ tierId: 'live' }),
          warmUp: vi.fn().mockResolvedValue(undefined),
          recognize: vi.fn().mockRejectedValue('initialization failed'),
          translateLine: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({
      stage: 'ocr',
      message: expect.stringContaining('initialization failed'),
    });
  });
});
