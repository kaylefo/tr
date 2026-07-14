/**
 * Ensures OCR runtime assets exist under public/tesseract.
 * Safe to re-run; downloads only missing tessdata files.
 */
import { access, copyFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'public/tesseract');
const coreDir = join(root, 'node_modules/tesseract.js-core');
const workerSrc = join(root, 'node_modules/tesseract.js/dist/worker.min.js');

const LOCAL_COPIES = [
  ['worker.min.js', workerSrc],
  ['tesseract-core-simd-lstm.wasm', join(coreDir, 'tesseract-core-simd-lstm.wasm')],
  ['tesseract-core-simd-lstm.js', join(coreDir, 'tesseract-core-simd-lstm.js')],
  ['tesseract-core-lstm.wasm', join(coreDir, 'tesseract-core-lstm.wasm')],
  ['tesseract-core-lstm.js', join(coreDir, 'tesseract-core-lstm.js')],
  ['tesseract-core-simd-lstm.wasm.js', join(coreDir, 'tesseract-core-simd-lstm.wasm.js')],
  ['tesseract-core-lstm.wasm.js', join(coreDir, 'tesseract-core-lstm.wasm.js')],
];

const REMOTE_FILES = [
  [
    'jpn.traineddata',
    'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/jpn.traineddata',
  ],
  [
    'jpn_vert.traineddata',
    'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/jpn_vert.traineddata',
  ],
  [
    'best/jpn.traineddata',
    'https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/jpn.traineddata',
  ],
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download ${url}: ${res.status}`);
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  } finally {
    clearTimeout(timer);
  }
}

await mkdir(outDir, { recursive: true });

for (const [name, src] of LOCAL_COPIES) {
  const dest = join(outDir, name);
  if (!(await exists(src))) {
    console.warn(`skip missing source ${src}`);
    continue;
  }
  await copyFile(src, dest);
  console.log(`copied ${name}`);
}

for (const [name, url] of REMOTE_FILES) {
  const dest = join(outDir, name);
  await mkdir(dirname(dest), { recursive: true });
  if (await exists(dest)) {
    console.log(`keep existing ${name}`);
    continue;
  }
  console.log(`downloading ${name}…`);
  await download(url, dest);
  console.log(`wrote ${name}`);
}

console.log('OCR assets ready in public/tesseract');
