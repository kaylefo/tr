import { createWorker } from 'tesseract.js';
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
let messageChain: Promise<void> = Promise.resolve();

const TESSDATA_FAST = 'https://tessdata.projectnaptha.com/4.0.0';
const TESSDATA_BEST = 'https://tessdata.projectnaptha.com/4.0.0_best';

function post(message: OcrOutbound): void {
  self.postMessage(message);
}

function postProgress(payload: OcrProgressPayload): void {
  post({ type: OCR_MESSAGE.PROGRESS, payload });
}

function langPathFor(profile: ReturnType<typeof profileToTessdata>): string {
  return profile === 'best' ? TESSDATA_BEST : TESSDATA_FAST;
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
    activeProfile = null;
  }

  const tessdata = profileToTessdata(langProfile);
  postProgress({ status: 'initializing', progress: 0 });

  worker = await createWorker(langs, 1, {
    logger: (msg) => {
      const progress =
        typeof msg.progress === 'number'
          ? Math.max(0, Math.min(100, msg.progress * 100))
          : undefined;
      postProgress({
        status: msg.status ?? 'downloading',
        progress,
        userJobId: msg.userJobId,
      });
    },
    langPath: langPathFor(tessdata),
    gzip: false,
  });

  activeProfile = langProfile;

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

function enqueue(task: () => Promise<void>): void {
  messageChain = messageChain.then(task, task);
}

self.addEventListener('message', (event: MessageEvent<OcrInbound>) => {
  const message = event.data;
  enqueue(async () => {
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
});

export {};
