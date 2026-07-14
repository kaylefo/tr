import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export function usePwaUpdate(): {
  needRefresh: boolean;
  offlineReady: boolean;
  updateApp: () => Promise<void>;
} {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateFn, setUpdateFn] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onOfflineReady() {
        setOfflineReady(true);
      },
    });
    // registerSW owns the activation/reload lifecycle. Calling reload ourselves
    // races the `controlling` event and can reload twice or interrupt a download.
    setUpdateFn(() => async () => {
      await updateSW(true);
    });
  }, []);

  return {
    needRefresh,
    offlineReady,
    updateApp: async () => {
      await updateFn?.();
    },
  };
}

export function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}
