import type { ConnectionState } from '../modules/connectivity/connectivity';
import { connectionLabel } from '../modules/connectivity/connectivity';

interface ConnectionIndicatorProps {
  state: ConnectionState;
}

export function ConnectionIndicator({ state }: ConnectionIndicatorProps) {
  return (
    <span className={`connection connection--${state}`} role="status" aria-live="polite">
      <span className="connection__dot" aria-hidden="true" />
      {connectionLabel(state)}
    </span>
  );
}
