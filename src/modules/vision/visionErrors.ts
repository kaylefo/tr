/** Tesseract.js often rejects with plain strings — normalize for UI and logging. */
export function toErrorMessage(err: unknown, fallback = 'Unknown error'): string {
  if (err instanceof Error) {
    const message = err.message.trim();
    return message || fallback;
  }
  if (typeof err === 'string') {
    const message = err.trim();
    return message || fallback;
  }
  if (err != null) {
    const message = String(err).trim();
    return message || fallback;
  }
  return fallback;
}

export function toError(err: unknown, fallback = 'Unknown error'): Error {
  return new Error(toErrorMessage(err, fallback));
}
