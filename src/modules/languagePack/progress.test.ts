import { describe, expect, it } from 'vitest';
import {
  clampPercent,
  formatProgressLabel,
  normalizeDownloadProgress,
  normalizeProgressPercent,
  progressFromBytes,
} from './progress';

describe('language pack progress', () => {
  it('normalizes fractional progress to percent', () => {
    expect(normalizeProgressPercent(0.42)).toBe(42);
    expect(normalizeProgressPercent(42)).toBe(42);
  });

  it('derives percent from loaded and total bytes', () => {
    expect(progressFromBytes(50, 200)).toBe(25);
  });

  it('prefers explicit percent over byte ratio', () => {
    const normalized = normalizeDownloadProgress({
      status: 'progress',
      progress: 0.75,
      loaded: 10,
      total: 100,
    });
    expect(normalized.progress).toBe(75);
  });

  it('clamps invalid values', () => {
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(140)).toBe(100);
  });

  it('formats a human-readable label', () => {
    const label = formatProgressLabel(
      normalizeDownloadProgress({ status: 'downloading', progress: 33.4, file: 'model.onnx' }),
    );
    expect(label).toContain('33%');
    expect(label).toContain('model.onnx');
  });
});
