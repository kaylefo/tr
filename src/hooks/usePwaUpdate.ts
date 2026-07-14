import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export function usePwaUpdate(): {
  needRefresh: boolean;
  offlineReady: boolean;
  updateApp: () => void;
} {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateFn, setUpdateFn] = useState<(() => void) | null>(null);

  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onOfflineReady() {
        setOfflineReady(true);
      },
      onRegisteredSW(_swUrl, registration) {
        if (registration) {
          setUpdateFn(() => () => {
            registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
            window.location.reload();
          });
        }
      },
    });
    setUpdateFn(() => updateSW);
  }, []);

  return {
    needRefresh,
    offlineReady,
    updateApp: () => updateFn?.(),
  };
}

export function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}
