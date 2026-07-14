export function normalizeUserError(error: unknown, fallback: string): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function logDevDiagnostic(label: string, error: unknown): void {
  if (import.meta.env.DEV) {
    console.warn(`[${label}]`, error);
  }
}
