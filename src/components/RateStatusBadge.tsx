import type { RateStatusLabel } from '../modules/currency/conversion';

interface RateStatusBadgeProps {
  label: RateStatusLabel;
  provider?: string;
  sourceDate?: string;
  fetchedAt?: number;
}

export function RateStatusBadge({
  label,
  provider,
  sourceDate,
  fetchedAt,
}: RateStatusBadgeProps) {
  const fetchedText =
    fetchedAt != null
      ? new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(fetchedAt))
      : null;

  return (
    <div className="rate-status" role="status" aria-live="polite">
      <span className={`rate-status__label rate-status__label--${label.replace(/\s+/g, '-').toLowerCase()}`}>
        {label}
      </span>
      {provider ? <span className="rate-status__meta">Source: {provider}</span> : null}
      {sourceDate ? <span className="rate-status__meta">Reference date: {sourceDate}</span> : null}
      {fetchedText ? <span className="rate-status__meta">Updated locally: {fetchedText}</span> : null}
    </div>
  );
}
