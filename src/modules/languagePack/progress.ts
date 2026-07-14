export interface NormalizedProgress {
  status: string;
  file?: string;
  progress: number;
  loaded?: number;
  total?: number;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function normalizeProgressPercent(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  if (value > 0 && value <= 1) return clampPercent(value * 100);
  return clampPercent(value);
}

export function progressFromBytes(loaded?: number, total?: number): number | undefined {
  if (loaded == null || total == null || total <= 0) return undefined;
  return clampPercent((loaded / total) * 100);
}

export function normalizeDownloadProgress(raw: {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}): NormalizedProgress {
  const fromBytes = progressFromBytes(raw.loaded, raw.total);
  const fromPercent = normalizeProgressPercent(raw.progress);
  const progress = fromPercent ?? fromBytes ?? 0;

  return {
    status: raw.status ?? 'downloading',
    file: raw.file,
    progress,
    loaded: raw.loaded,
    total: raw.total,
  };
}

export function formatProgressLabel(progress: NormalizedProgress): string {
  const pct = `${Math.round(progress.progress)}%`;
  const file = progress.file ? `: ${progress.file}` : '';
  return `${progress.status}${file} ${pct}`.trim();
}
