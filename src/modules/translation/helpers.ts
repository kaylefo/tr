export function extractTranslationText(
  result: unknown,
): string {
  if (Array.isArray(result)) {
    const first = result[0] as { translation_text?: string } | undefined;
    return first?.translation_text?.trim() ?? '';
  }
  if (result && typeof result === 'object' && 'translation_text' in result) {
    return String((result as { translation_text?: string }).translation_text ?? '').trim();
  }
  return '';
}

export function progressPayload(progress: Record<string, unknown>): {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
} {
  return {
    status: typeof progress.status === 'string' ? progress.status : 'downloading',
    file: typeof progress.file === 'string' ? progress.file : undefined,
    progress: typeof progress.progress === 'number' ? progress.progress : undefined,
    loaded: typeof progress.loaded === 'number' ? progress.loaded : undefined,
    total: typeof progress.total === 'number' ? progress.total : undefined,
  };
}
