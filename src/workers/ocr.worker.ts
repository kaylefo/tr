import { createWorker } from 'tesseract.js';
import { VISION_OCR_TEST_TEXT } from '../config/vision';
import {
  OCR_MESSAGE,
  profileToLangs,
  profileToTessdata,
  type OcrInbound,
  type OcrLineBox,
  type OcrOutbound,
  type OcrProgressPayload,
} from '../modules/vision/ocrMessages';

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

let worker: TesseractWorker | null = null;
let activeProfile: string | null = null;

function post(message: OcrOutbound): void {
  self.postMessage(message);
}

function postProgress(payload: OcrProgressPayload): void {
  post({ type: OCR_MESSAGE.PROGRESS, payload });
}

function langPathFor(profile: ReturnType<typeof profileToTessdata>): string {
  if (profile === 'best') {
    return 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_best@main';
  }
  return 'https://tessdata.projectnaptha.com/4.0.0';
}

function mapLines(data: {
  lines?: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    words?: Array<{
      text: string;
      confidence: number;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }>;
  }>;
  text?: string;
}): { lines: OcrLineBox[]; fullText: string } {
  const lines: OcrLineBox[] = (data.lines ?? [])
    .filter((line) => line.text?.trim())
    .map((line) => ({
      text: line.text.trim(),
      confidence: line.confidence ?? 0,
      bbox: line.bbox,
      words: (line.words ?? []).map((w) => ({
        text: w.text,
        confidence: w.confidence ?? 0,
        bbox: w.bbox,
      })),
    }));

  return { lines, fullText: data.text?.trim() ?? lines.map((l) => l.text).join('\n') };
}

async function createOcrWorker(message: Extract<OcrInbound, { type: typeof OCR_MESSAGE.INIT }>): Promise<void> {
  const { langs, langProfile } = message.payload;

  if (worker && activeProfile === langProfile) {
    post({
      type: OCR_MESSAGE.READY,
      payload: { langs, langProfile, validatedAt: Date.now() },
    });
    return;
  }

  if (worker) {
    await worker.terminate();
    worker = null;
  }

  const tessdata = profileToTessdata(langProfile);

  worker = await createWorker(langs, 1, {
    logger: (msg) => {
      postProgress({
        status: msg.status ?? 'downloading',
        progress: typeof msg.progress === 'number' ? msg.progress * 100 : undefined,
        userJobId: msg.userJobId,
      });
    },
    langPath: langPathFor(tessdata),
    gzip: true,
  });

  activeProfile = langProfile;

  const testCanvas = new OffscreenCanvas(320, 96);
  const ctx = testCanvas.getContext('2d');
  if (!ctx) throw new Error('Validation canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, testCanvas.width, testCanvas.height);
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(VISION_OCR_TEST_TEXT, 16, 60);

  const validation = await worker.recognize(testCanvas);
  const text = validation.data.text?.replace(/\s/g, '') ?? '';
  if (!text.includes('こんに') && !text.includes('にちは')) {
    throw new Error('OCR validation did not detect Japanese test text');
  }

  post({
    type: OCR_MESSAGE.READY,
    payload: { langs, langProfile, validatedAt: Date.now() },
  });
}

async function recognize(message: Extract<OcrInbound, { type: typeof OCR_MESSAGE.RECOGNIZE }>): Promise<void> {
  if (!worker) {
    post({
      type: OCR_MESSAGE.ERROR,
      payload: { requestId: message.payload.requestId, code: 'OCR_NOT_READY', message: 'OCR not initialized' },
    });
    return;
  }

  const { imageData, requestId, psm } = message.payload;
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.putImageData(imageData, 0, 0);

  await worker.setParameters({
    tessedit_pageseg_mode: psm as never,
    preserve_interword_spaces: '1',
  });

  const result = await worker.recognize(canvas);
  const mapped = mapLines(result.data);

  post({
    type: OCR_MESSAGE.RESULT,
    payload: { requestId, lines: mapped.lines, fullText: mapped.fullText },
  });
}

self.addEventListener('message', async (event: MessageEvent<OcrInbound>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case OCR_MESSAGE.INIT:
        await createOcrWorker(message);
        break;
      case OCR_MESSAGE.RECOGNIZE:
        await recognize(message);
        break;
      case OCR_MESSAGE.HEALTH:
        if (worker && activeProfile) {
          post({
            type: OCR_MESSAGE.READY,
            payload: {
              langs: profileToLangs(activeProfile as 'jpn-fast'),
              langProfile: activeProfile as 'jpn-fast',
              validatedAt: Date.now(),
            },
          });
        } else {
          post({ type: OCR_MESSAGE.ERROR, payload: { code: 'OCR_NOT_READY', message: 'OCR not ready' } });
        }
        break;
      case OCR_MESSAGE.DISPOSE:
        if (worker) {
          await worker.terminate();
          worker = null;
          activeProfile = null;
        }
        break;
      default:
        break;
    }
  } catch (err) {
    post({
      type: OCR_MESSAGE.ERROR,
      payload: {
        code: 'OCR_INIT_FAILED',
        message: err instanceof Error ? err.message : 'OCR worker error',
      },
    });
  }
});

export {};
