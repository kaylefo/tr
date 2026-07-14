export const OCR_MESSAGE = {
  INIT: 'ocr_initialize',
  PROGRESS: 'ocr_progress',
  READY: 'ocr_ready',
  RECOGNIZE: 'ocr_recognize',
  RESULT: 'ocr_result',
  ERROR: 'ocr_error',
  DISPOSE: 'ocr_dispose',
  HEALTH: 'ocr_health',
} as const;

export type OcrLangProfile = 'jpn-fast' | 'jpn-best' | 'jpn-vert';

export interface OcrInitPayload {
  langs: string;
  langProfile: OcrLangProfile;
  tessdataPath?: 'fast' | 'best';
}

export interface OcrProgressPayload {
  status: string;
  progress?: number;
  loaded?: number;
  total?: number;
  userJobId?: string;
}

export interface OcrRecognizePayload {
  requestId: number;
  imageData: ImageData;
  psm: number;
}

export interface OcrWordBox {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrLineBox {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: OcrWordBox[];
}

export interface OcrResultPayload {
  requestId: number;
  lines: OcrLineBox[];
  fullText: string;
}

export interface OcrReadyPayload {
  langs: string;
  langProfile: OcrLangProfile;
  validatedAt: number;
}

export interface OcrErrorPayload {
  requestId?: number;
  code: string;
  message: string;
}

export type OcrInbound =
  | { type: typeof OCR_MESSAGE.INIT; payload: OcrInitPayload }
  | { type: typeof OCR_MESSAGE.RECOGNIZE; payload: OcrRecognizePayload }
  | { type: typeof OCR_MESSAGE.DISPOSE; payload?: undefined }
  | { type: typeof OCR_MESSAGE.HEALTH; payload?: undefined };

export type OcrOutbound =
  | { type: typeof OCR_MESSAGE.PROGRESS; payload: OcrProgressPayload }
  | { type: typeof OCR_MESSAGE.READY; payload: OcrReadyPayload }
  | { type: typeof OCR_MESSAGE.RESULT; payload: OcrResultPayload }
  | { type: typeof OCR_MESSAGE.ERROR; payload: OcrErrorPayload };

export function profileToLangs(profile: OcrLangProfile): string {
  switch (profile) {
    case 'jpn-vert':
      // Standard jpn model + vertical PSM is more reliable than jpn+jpn_vert on mobile.
      return 'jpn';
    case 'jpn-best':
    case 'jpn-fast':
    default:
      return 'jpn';
  }
}

export function profileToLangPath(profile: OcrLangProfile): string {
  const origin =
    typeof self !== 'undefined' && 'location' in self && self.location?.origin
      ? self.location.origin
      : '';
  const basePath = (
    (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) ||
    '/'
  ).replace(/^\.\//, '/');
  const root = `${origin}${basePath.endsWith('/') ? basePath : `${basePath}/`}`;
  return profile === 'jpn-best' ? `${root}tesseract/best` : `${root}tesseract`;
}

export function profileToTessdata(profile: OcrLangProfile): 'fast' | 'best' {
  return profile === 'jpn-best' ? 'best' : 'fast';
}
