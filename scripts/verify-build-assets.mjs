import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const required = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'icons/icon-32.png',
  'tesseract/worker.min.js',
  'tesseract/jpn.traineddata',
  'tesseract/jpn_vert.traineddata',
  'tesseract/best/jpn.traineddata',
  'tesseract/tesseract-core-simd-lstm.wasm',
  'tesseract/tesseract-core-simd-lstm.wasm.js',
];

for (const path of required) {
  await access(join(dist, path));
}

const manifest = JSON.parse(
  await readFile(join(dist, 'manifest.webmanifest'), 'utf8'),
);
const expectedBase = process.env.GITHUB_PAGES === 'true' ? '/tr/' : './';

if (manifest.start_url !== expectedBase || manifest.scope !== expectedBase) {
  throw new Error(
    `Manifest base mismatch: expected ${expectedBase}, got start=${manifest.start_url} scope=${manifest.scope}`,
  );
}

console.log(`Verified ${required.length} production assets and manifest base ${expectedBase}`);
