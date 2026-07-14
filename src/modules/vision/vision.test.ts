import { describe, expect, it } from 'vitest';
import { tierSupportsMode, getVisionTier } from '../../config/vision';
import { mergeAdjacentLines, containsJapanese, wrapOverlayText } from './imageProcessing';
import type { OcrLineBox } from './ocrMessages';

describe('vision tiers', () => {
  it('essential supports photo but not live', () => {
    expect(tierSupportsMode('essential', 'photo')).toBe(true);
    expect(tierSupportsMode('essential', 'live')).toBe(false);
  });

  it('live supports both modes', () => {
    expect(tierSupportsMode('live', 'photo')).toBe(true);
    expect(tierSupportsMode('live', 'live')).toBe(true);
    expect(getVisionTier('live').components).toEqual(['translation-ja-en', 'ocr-jpn-vert']);
  });

  it('defines three tiers with components', () => {
    expect(getVisionTier('standard').components).toContain('ocr-jpn-best');
    expect(getVisionTier('live').components).toContain('ocr-jpn-vert');
  });
});

describe('image processing', () => {
  it('detects japanese text', () => {
    expect(containsJapanese('こんにちは')).toBe(true);
    expect(containsJapanese('hello')).toBe(false);
  });

  it('merges adjacent lines', () => {
    const lines: OcrLineBox[] = [
      {
        text: 'メニュー',
        confidence: 90,
        bbox: { x0: 10, y0: 10, x1: 100, y1: 30 },
        words: [],
      },
      {
        text: '一覧',
        confidence: 88,
        bbox: { x0: 12, y0: 32, x1: 80, y1: 50 },
        words: [],
      },
    ];
    const merged = mergeAdjacentLines(lines);
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toContain('メニュー');
  });

  it('wraps overlay text', () => {
    const lines = wrapOverlayText('This is a longer English translation line for display');
    expect(lines.length).toBeGreaterThan(1);
  });
});
