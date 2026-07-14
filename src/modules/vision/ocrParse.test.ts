import { describe, expect, it } from 'vitest';
import { parseTesseractPage } from './ocrParse';

describe('parseTesseractPage', () => {
  it('extracts lines from v6 blocks output', () => {
    const lines = parseTesseractPage(
      {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: 'こんにちは',
                    confidence: 92,
                    bbox: { x0: 10, y0: 20, x1: 200, y1: 60 },
                    words: [],
                  },
                ],
              },
            ],
          },
        ],
      },
      640,
      480,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('こんにちは');
    expect(lines[0].bbox.x1).toBe(200);
  });

  it('falls back to full text when blocks are missing', () => {
    const lines = parseTesseractPage(
      { text: '駅はどこですか', confidence: 70 },
      800,
      600,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain('駅');
  });

  it('returns empty for non-japanese text without blocks', () => {
    expect(parseTesseractPage({ text: 'hello world' }, 100, 100)).toEqual([]);
  });
});
