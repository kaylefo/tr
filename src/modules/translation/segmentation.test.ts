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
