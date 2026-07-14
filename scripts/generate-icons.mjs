import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '../public/icons');

const sizes = [32, 72, 96, 128, 144, 152, 180, 192, 384, 512];

function buildSvg(size) {
  const r = size * 0.18;
  const cx = size / 2;
  const cy = size / 2;
  const bg = '#f7f4ef';
  const accent = '#c73e3a';
  const ring = '#2b2b2e';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/>
  <circle cx="${cx}" cy="${cy}" r="${size * 0.34}" fill="none" stroke="${ring}" stroke-width="${Math.max(2, size * 0.04)}"/>
  <circle cx="${cx}" cy="${cy}" r="${size * 0.12}" fill="${accent}"/>
  <text x="${cx}" y="${cy + size * 0.28}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${size * 0.22}" font-weight="700" fill="${ring}">¥</text>
</svg>`;
}

function buildMaskableSvg(size) {
  const bg = '#c73e3a';
  const fg = '#f7f4ef';
  const cx = size / 2;
  const cy = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  <circle cx="${cx}" cy="${cy}" r="${size * 0.28}" fill="none" stroke="${fg}" stroke-width="${Math.max(3, size * 0.05)}"/>
  <text x="${cx}" y="${cy + size * 0.1}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${size * 0.38}" font-weight="700" fill="${fg}">¥</text>
</svg>`;
}

await mkdir(outDir, { recursive: true });

for (const size of sizes) {
  const svg = buildSvg(size);
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  await sharp(Buffer.from(svg)).png().toFile(join(outDir, name));
}

for (const size of [192, 512]) {
  const svg = buildMaskableSvg(size);
  await sharp(Buffer.from(svg)).png().toFile(join(outDir, `icon-${size}-maskable.png`));
}

await writeFile(
  join(outDir, 'icon.svg'),
  buildSvg(512),
);

console.log('Generated PWA icons in public/icons');
