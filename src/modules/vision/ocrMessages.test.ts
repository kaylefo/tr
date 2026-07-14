import { describe, expect, it } from 'vitest';
import { profileToLangPath, profileToLangs } from './ocrMessages';
import { toErrorMessage } from './visionErrors';

describe('profileToLangs', () => {
  it('uses standard jpn for vertical profile', () => {
    expect(profileToLangs('jpn-vert')).toBe('jpn');
    expect(profileToLangs('jpn-vert')).not.toContain('+');
  });

  it('uses same-origin tessdata path for live OCR', () => {
    expect(profileToLangPath('jpn-vert')).toContain('tesseract');
    expect(profileToLangPath('jpn-fast')).toContain('tesseract');
  });

  it('uses best tessdata path for photo OCR', () => {
    expect(profileToLangPath('jpn-best')).toContain('best_int');
  });
});

describe('toErrorMessage', () => {
  it('preserves string rejections from tesseract workers', () => {
    expect(toErrorMessage('initialization failed', 'fallback')).toBe('initialization failed');
  });

  it('uses fallback for empty errors', () => {
    expect(toErrorMessage('', 'Text recognition failed')).toBe('Text recognition failed');
  });
});
