/**
 * Generates a deterministic Japanese OCR test scene with horizontal text,
 * vertical columns, mixed sizes/fonts, partial occlusion, and low-contrast areas.
 *
 * Output: e2e/fixtures/japanese-scene.png + japanese-scene.manifest.json
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '../e2e/fixtures');
const width = 1200;
const height = 1600;

/** Substrings we expect OCR to recover from at least one region. */
export const EXPECTED_OCR_FRAGMENTS = [
  'ラーメン',
  '営業',
  '出口',
  '禁煙',
  '880',
  'いくら',
];

function buildSceneSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="blur-soft" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="1.2"/>
    </filter>
    <linearGradient id="fade-band" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#2b2b2e" stop-opacity="0.55"/>
      <stop offset="45%" stop-color="#2b2b2e" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#2b2b2e" stop-opacity="0.45"/>
    </linearGradient>
  </defs>

  <!-- wall background -->
  <rect width="${width}" height="${height}" fill="#f3ece1"/>
  <rect x="40" y="40" width="1120" height="1520" rx="18" fill="#faf6ef" stroke="#d8cfc0" stroke-width="4"/>

  <!-- top horizontal sign (large bold) -->
  <rect x="80" y="90" width="1040" height="170" rx="12" fill="#c73e3a"/>
  <text x="600" y="175" text-anchor="middle" font-family="'Noto Sans CJK JP','Noto Sans JP','Hiragino Sans','Yu Gothic',sans-serif" font-size="72" font-weight="700" fill="#fff8f0">ラーメン専門店 営業中</text>
  <text x="600" y="230" text-anchor="middle" font-family="'Noto Sans CJK JP','Noto Sans JP',sans-serif" font-size="34" fill="#ffe8de">つけ麺・チャーシュー増量中</text>

  <!-- left vertical column -->
  <rect x="110" y="320" width="120" height="520" rx="8" fill="#2b2b2e"/>
  <text x="170" y="380" text-anchor="middle" font-family="'Noto Sans CJK JP','Noto Sans JP',serif" font-size="92" font-weight="700" fill="#faf6ef" writing-mode="tb">出口</text>

  <!-- right vertical column -->
  <rect x="970" y="340" width="110" height="480" rx="8" fill="#f7f4ef" stroke="#2b2b2e" stroke-width="5"/>
  <text x="1025" y="400" text-anchor="middle" font-family="'Noto Sans CJK JP','Noto Sans JP',serif" font-size="78" font-weight="700" fill="#c73e3a" writing-mode="tb">禁煙</text>

  <!-- center menu block (mixed sizes) -->
  <rect x="280" y="360" width="640" height="430" rx="10" fill="#ffffff" stroke="#cfc6b8" stroke-width="3"/>
  <text x="320" y="430" font-family="'Noto Sans CJK JP','Noto Sans JP',sans-serif" font-size="54" font-weight="700" fill="#1a1a1a">本日のおすすめ</text>
  <text x="320" y="510" font-family="'Noto Sans CJK JP','Noto Sans JP',sans-serif" font-size="44" fill="#2b2b2e">味噌ラーメン</text>
  <text x="780" y="510" text-anchor="end" font-family="'Noto Sans CJK JP','Noto Sans JP',sans-serif" font-size="48" font-weight="700" fill="#c73e3a">880円</text>
  <text x="320" y="590" font-family="'Noto Sans CJK JP','Noto Sans JP',sans-serif" font-size="38" fill="#444">塩ラーメン</text>
  <text x="780" y="590" text-anchor="end" font-family="'Noto Sans CJK JP','Noto Sans JP',sans-serif" font-size="42" fill="#444">780円</text>
  <text x="320" y="680" font-family="'Noto Sans CJK JP','Noto Sans JP',sans-serif" font-size="36" fill="#666">これはいくらですか</text>
  <text x="320" y="740" font-family="'Noto Sans CJK JP','Noto Sans JP',sans-serif" font-size="28" fill="#888">店内飲食のみ・持ち帰り不可</text>

  <!-- partial occlusion band (simulates pole/reflection) -->
  <polygon points="250,520 920,470 980,760 210,820" fill="url(#fade-band)"/>

  <!-- low-contrast footer text -->
  <text x="120" y="920" font-family="'Noto Sans CJK JP','Noto Sans JP',sans-serif" font-size="30" fill="#bdb5a8">お土産 限定</text>
  <text x="120" y="970" font-family="'Noto Sans CJK JP','Noto Sans JP',sans-serif" font-size="26" fill="#c8c0b4" filter="url(#blur-soft)">数量限定 本日のみ</text>

  <!-- small angled price tag -->
  <g transform="translate(760,860) rotate(-8)">
    <rect x="0" y="0" width="320" height="110" rx="8" fill="#fff9ef" stroke="#c73e3a" stroke-width="3"/>
    <text x="24" y="68" font-family="'Noto Sans CJK JP','Noto Sans JP',sans-serif" font-size="40" font-weight="700" fill="#2b2b2e">特製つけ麺</text>
  </g>

  <!-- additional vertical note (narrow column) -->
  <text x="880" y="980" font-family="'Noto Sans CJK JP','Noto Sans JP',serif" font-size="52" fill="#2b2b2e" writing-mode="tb">本日</text>
  <text x="940" y="980" font-family="'Noto Sans CJK JP','Noto Sans JP',serif" font-size="52" fill="#2b2b2e" writing-mode="tb">限定</text>

  <!-- bottom dense horizontal strip (small font) -->
  <rect x="80" y="1180" width="1040" height="300" rx="12" fill="#ece4d8"/>
  <text x="120" y="1250" font-family="'Noto Sans CJK JP','Noto Sans JP',monospace" font-size="24" fill="#333">営業時間 11:00-22:00  定休日 水曜日</text>
  <text x="120" y="1300" font-family="'Noto Sans CJK JP','Noto Sans JP',sans-serif" font-size="22" fill="#555">クレジットカード可  現金のみの商品あり</text>
  <text x="120" y="1350" font-family="'Noto Sans CJK JP','Noto Sans JP',sans-serif" font-size="20" fill="#777">アレルギー表示はスタッフまでお尋ねください</text>
  <text x="120" y="1400" font-family="'Noto Sans CJK JP','Noto Sans JP',sans-serif" font-size="18" fill="#999">※写真はイメージです</text>
</svg>`;
}

await mkdir(outDir, { recursive: true });

const pngPath = join(outDir, 'japanese-scene.png');
const manifestPath = join(outDir, 'japanese-scene.manifest.json');

await sharp(Buffer.from(buildSceneSvg()))
  .png({ compressionLevel: 9 })
  .toFile(pngPath);

await writeFile(
  manifestPath,
  JSON.stringify(
    {
      width,
      height,
      description: 'Mixed horizontal/vertical Japanese signage with occlusion and low contrast',
      expectedFragments: EXPECTED_OCR_FRAGMENTS,
      /** Minimum distinct fragments OCR must match for the test to pass */
      minimumMatches: 4,
    },
    null,
    2,
  ),
);

console.log(`Wrote ${pngPath}`);
console.log(`Wrote ${manifestPath}`);
