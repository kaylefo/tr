import { describe, expect, it } from 'vitest';
import {
  reassembleTranslation,
  segmentJapaneseText,
} from './segmentation';

describe('segmentation', () => {
  it('preserves blank lines', () => {
    const segments = segmentJapaneseText('こんにちは\n\nさようなら');
    const translated = ['Hello', 'Goodbye'];
    expect(reassembleTranslation(segments, translated)).toContain('\n\n');
  });

  it('splits long japanese text', () => {
    const long = 'これはテストです。'.repeat(80);
    const segments = segmentJapaneseText(long);
    const nonBlank = segments.filter((s) => !s.isBlank);
    expect(nonBlank.length).toBeGreaterThan(1);
    nonBlank.forEach((s) => expect(s.text.length).toBeLessThanOrEqual(400));
  });

  it('rejects extreme input', () => {
    expect(() => segmentJapaneseText('あ'.repeat(9000))).toThrow('INPUT_TOO_LONG');
  });

  it('does not split surrogate pairs when no boundary exists', () => {
    const emoji = '😀';
    const input = emoji.repeat(500);
    const segments = segmentJapaneseText(input, 50);
    const rejoined = segments.filter((s) => !s.isBlank).map((s) => s.text).join('');
    expect([...rejoined].every((ch) => ch === emoji)).toBe(true);
    segments
      .filter((s) => !s.isBlank)
      .forEach((s) => {
        const first = s.text.charCodeAt(0);
        const last = s.text.charCodeAt(s.text.length - 1);
        expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
        expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
      });
  });

  it('splits on sentence boundaries when available', () => {
    const input = `${'あ'.repeat(30)}。${'い'.repeat(30)}`;
    const segments = segmentJapaneseText(input, 40);
    const nonBlank = segments.filter((s) => !s.isBlank);
    expect(nonBlank.length).toBeGreaterThan(1);
    expect(nonBlank[0].text.endsWith('。')).toBe(true);
  });
});

describe('stale translation rejection', () => {
  it('ignores lower request ids', () => {
    let latest = 0;
    const accept = (requestId: number) => {
      if (requestId >= latest) {
        latest = requestId;
        return true;
      }
      return false;
    };
    expect(accept(1)).toBe(true);
    expect(accept(2)).toBe(true);
    expect(accept(1)).toBe(false);
  });
});
