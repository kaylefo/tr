import { useCallback, useEffect, useRef, useState } from 'react';
import type { NormalizedRate } from '../modules/currency/types';
import {
  loadInitialRate,
  refreshExchangeRate,
  shouldAutoRefresh,
} from '../modules/currency/rateService';
import { useIsOnline } from './useConnectivity';

export function useExchangeRate(autoRefreshEnabled: boolean) {
  const isOnline = useIsOnline();
  const [rate, setRate] = useState<NormalizedRate | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const refresh = useCallback(
    async (force = false) => {
      setChecking(true);
      setError(null);
      try {
        const result = await refreshExchangeRate({ force, isOnline });
        if (result.rate) setRate(result.rate);
        if (result.error) setError(result.error);
      } finally {
        setChecking(false);
      }
    },
    [isOnline],
  );

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void loadInitialRate(isOnline).then((result) => {
      if (result.rate) setRate(result.rate);
      if (shouldAutoRefresh(result.rate ?? null, autoRefreshEnabled) && isOnline) {
        void refresh(false);
      }
    });
  }, [autoRefreshEnabled, isOnline, refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && isOnline) {
        if (shouldAutoRefresh(rate, autoRefreshEnabled)) {
          void refresh(false);
        }
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [autoRefreshEnabled, isOnline, rate, refresh]);

  useEffect(() => {
    if (isOnline && shouldAutoRefresh(rate, autoRefreshEnabled)) {
      void refresh(false);
    } else if (rate) {
      setRate({ ...rate, freshnessStatus: isOnline ? rate.freshnessStatus : 'offline' });
    }
  }, [isOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  return { rate, checking, error, refresh, isOnline };
}
