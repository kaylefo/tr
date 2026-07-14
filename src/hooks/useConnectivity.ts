import { useEffect, useState } from 'react';
import { subscribeConnectivity, probeConnectivity, type ConnectionState } from '../modules/connectivity/connectivity';

export function useConnectivity(): ConnectionState {
  const [state, setState] = useState<ConnectionState>(
    typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline',
  );

  useEffect(() => {
    const update = async () => {
      setState(await probeConnectivity());
    };
    void update();
    return subscribeConnectivity(() => {
      void update();
    });
  }, []);

  return state;
}

export function useIsOnline(): boolean {
  const state = useConnectivity();
  return state === 'online' || state === 'uncertain';
}
