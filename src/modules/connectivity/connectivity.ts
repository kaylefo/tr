export type ConnectionState = 'online' | 'offline' | 'uncertain';

export function getNavigatorOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

export function subscribeConnectivity(
  onChange: (online: boolean) => void,
): () => void {
  const handler = () => onChange(getNavigatorOnline());
  window.addEventListener('online', handler);
  window.addEventListener('offline', handler);
  document.addEventListener('visibilitychange', handler);
  return () => {
    window.removeEventListener('online', handler);
    window.removeEventListener('offline', handler);
    document.removeEventListener('visibilitychange', handler);
  };
}

export async function probeConnectivity(): Promise<ConnectionState> {
  if (!navigator.onLine) return 'offline';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    await fetch('/icons/icon-32.png', {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return 'online';
  } catch {
    return navigator.onLine ? 'uncertain' : 'offline';
  }
}

export function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case 'online':
      return 'Online';
    case 'offline':
      return 'Offline';
    default:
      return 'Connection uncertain';
  }
}
