import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeConnectivity } from './connectivity';

describe('probeConnectivity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the configured base path and checks response status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeConnectivity()).resolves.toBe('online');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('icons/icon-32.png'),
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  it('reports uncertain when the probe fails but navigator remains online', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(probeConnectivity()).resolves.toBe('uncertain');
  });

  it('does not probe when navigator is offline', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeConnectivity()).resolves.toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
