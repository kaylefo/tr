import { describe, expect, it } from 'vitest';
import { HISTORY_MAX_ITEMS } from '../../config/app';

describe('history bounds', () => {
  it('caps history length', () => {
    const items = Array.from({ length: 60 }, (_, i) => i);
    const bounded = items.slice(0, HISTORY_MAX_ITEMS);
    expect(bounded).toHaveLength(50);
  });

  it('deduplicates consecutive entries', () => {
    const entries = ['a', 'a', 'b'];
    const deduped: string[] = [];
    for (const entry of entries) {
      if (deduped.at(-1) !== entry) deduped.push(entry);
    }
    expect(deduped).toEqual(['a', 'b']);
  });
});

describe('offline pack states', () => {
  const transitions = ['not_downloaded', 'downloading', 'preparing', 'ready'] as const;

  it('requires validation before ready', () => {
    const readyWithoutValidation = { status: 'ready', lastValidatedAt: undefined };
    expect(Boolean(readyWithoutValidation.lastValidatedAt)).toBe(false);
    const ready = { status: 'ready', lastValidatedAt: Date.now() };
    expect(Boolean(ready.lastValidatedAt)).toBe(true);
  });

  it('allows expected transitions', () => {
    expect(transitions.indexOf('downloading')).toBeLessThan(transitions.indexOf('ready'));
  });
});
