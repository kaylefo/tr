import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE_PATH = join(process.cwd(), 'e2e/fixtures/japanese-scene.png');
const MANIFEST = JSON.parse(
  readFileSync(join(process.cwd(), 'e2e/fixtures/japanese-scene.manifest.json'), 'utf8'),
) as { expectedFragments: string[]; minimumMatches: number };

const LOCAL_OCR_ASSETS = [
  '/tesseract/worker.min.js',
  '/tesseract/jpn.traineddata',
  '/tesseract/tesseract-core-simd-lstm.wasm',
  '/tesseract/tesseract-core-simd-lstm.wasm.js',
];

class StepTracker {
  private readonly startedAt = Date.now();

  constructor(private readonly page: Page) {}

  private stamp(label: string): string {
    return `[e2e +${Date.now() - this.startedAt}ms] ${label}`;
  }

  log(message: string): void {
    console.log(this.stamp(message));
  }

  async run<T>(name: string, budgetMs: number, fn: () => Promise<T>): Promise<T> {
    this.log(`▶ ${name} (budget ${budgetMs}ms)`);
    const stepStart = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Step timed out after ${budgetMs}ms: ${name}`));
          }, budgetMs);
        }),
      ]);
      this.log(`✓ ${name} (${Date.now() - stepStart}ms)`);
      return result;
    } catch (err) {
      const alertText = await this.page
        .locator('.notice--warn, [role="alert"]')
        .allTextContents()
        .catch(() => []);
      this.log(`✘ ${name} after ${Date.now() - stepStart}ms`);
      if (alertText.length) this.log(`UI alerts: ${alertText.join(' | ')}`);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

async function mockRateApis(page: Page) {
  const payload = { date: '2026-07-13', jpy: { usd: 0.00617 } };
  await page.route('**/currencies/jpy.min.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }),
  );
  await page.route('**/frankfurter.dev/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ date: '2026-07-13', rates: { USD: 0.00617 } }),
    }),
  );
}

async function seedReadyEssentialPack(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('japan-pocket', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('offlinePacks')) db.createObjectStore('offlinePacks');
        if (!db.objectStoreNames.contains('visionPacks')) db.createObjectStore('visionPacks');
      };
      request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['offlinePacks', 'visionPacks'], 'readwrite');
        tx.objectStore('offlinePacks').put(
          {
            packId: 'ja-en-v1',
            modelId: 'Xenova/opus-mt-ja-en',
            direction: 'ja-en',
            label: 'Japanese → English',
            status: 'ready',
            lastValidatedAt: Date.now(),
            executionMode: 'wasm',
            version: 1,
          },
          'ja-en-v1',
        );
        tx.objectStore('visionPacks').put(
          {
            packId: 'vision-essential-v1',
            tierId: 'essential',
            label: 'Essential',
            status: 'ready',
            version: 2,
            lastValidatedAt: Date.now(),
            components: [
              {
                id: 'translation-ja-en',
                label: 'Translation (Xenova/opus-mt-ja-en)',
                status: 'ready',
                progress: 100,
              },
              {
                id: 'ocr-jpn-fast',
                label: 'Japanese OCR (fast)',
                status: 'ready',
                progress: 100,
              },
            ],
          },
          'vision-essential-v1',
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error('indexedDB write failed'));
      };
    });
  });
}

function countFragmentMatches(text: string, fragments: string[]): number {
  return fragments.filter((fragment) => text.includes(fragment)).length;
}

test.describe('Japan Pocket · See OCR fixture', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('jp-first-use-seen', '1');
      window.__JP_E2E__ = {
        mockTranslate: true,
        mockPackDownload: true,
        translations: {
          ラーメン: 'Ramen',
          営業: 'Open',
          出口: 'Exit',
          禁煙: 'No smoking',
          いくら: 'How much',
        },
      };
    });
    await mockRateApis(page);
    page.on('dialog', (dialog) => void dialog.accept());
  });

  test('recognizes mixed Japanese text from static fixture photo', async ({ page }) => {
    test.setTimeout(120_000);
    const steps = new StepTracker(page);

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') steps.log(`browser error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => steps.log(`pageerror: ${err.message}`));
    page.on('requestfailed', (req) => {
      steps.log(
        `request failed: ${req.method()} ${req.url()} :: ${req.failure()?.errorText ?? 'unknown'}`,
      );
    });

    await steps.run('open app', 15_000, async () => {
      const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
      expect(response?.ok() ?? false).toBe(true);
      await page.waitForSelector('#convert-heading', { state: 'visible' });
    });

    await steps.run('preflight local OCR assets', 15_000, async () => {
      const results = await page.evaluate(async (assets) => {
        const out: Array<{ path: string; ok: boolean; status: number; ms: number }> = [];
        for (const path of assets) {
          const started = performance.now();
          const res = await fetch(path, { method: 'GET', cache: 'no-store' });
          out.push({
            path,
            ok: res.ok,
            status: res.status,
            ms: Math.round(performance.now() - started),
          });
        }
        return out;
      }, LOCAL_OCR_ASSETS);

      for (const result of results) {
        steps.log(`asset ${result.path} -> ${result.status} in ${result.ms}ms`);
        expect(result.ok, `${result.path} must be reachable`).toBe(true);
        expect(result.ms, `${result.path} took too long`).toBeLessThan(5_000);
      }
    });

    await steps.run('seed ready Essential pack (skip remote downloads)', 10_000, async () => {
      await seedReadyEssentialPack(page);
    });

    await steps.run('open See → Photo with seeded pack', 15_000, async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'See' }).click();
      await expect(page.getByRole('heading', { name: 'See' })).toBeVisible();
      await page.getByRole('tab', { name: 'Photo' }).click();
      await expect(page.getByRole('button', { name: 'Choose photo' })).toBeEnabled({
        timeout: 10_000,
      });
      steps.log('Choose photo enabled — pack is active');
    });

    await steps.run('upload Japanese fixture and wait for overlays', 60_000, async () => {
      const fileInput = page.locator('input[type="file"][accept="image/*"]');
      await fileInput.setInputFiles(FIXTURE_PATH);
      steps.log('fixture uploaded; waiting for OCR overlays');

      const overlay = page.locator('.translation-overlay__label').first();
      const alert = page.locator('.notice--warn, [role="alert"]').first();

      const winner = await Promise.race([
        overlay.waitFor({ state: 'visible', timeout: 55_000 }).then(() => 'overlay' as const),
        alert.waitFor({ state: 'visible', timeout: 55_000 }).then(async () => {
          const message = (await alert.textContent())?.trim() ?? 'unknown alert';
          throw new Error(`Vision pipeline error: ${message}`);
        }),
      ]);
      steps.log(`pipeline finished with: ${winner}`);
    });

    await steps.run('assert OCR recovered expected Japanese fragments', 5_000, async () => {
      const overlaySources = await page.locator('.translation-overlay__source').allTextContents();
      const overlayEnglish = await page.locator('.translation-overlay__english').allTextContents();
      const combined = [...overlaySources, ...overlayEnglish].join('\n');
      steps.log(`overlay sources (${overlaySources.length}): ${overlaySources.join(' | ')}`);

      expect(overlaySources.length).toBeGreaterThan(0);
      const matches = countFragmentMatches(combined, MANIFEST.expectedFragments);
      steps.log(`fragment matches ${matches}/${MANIFEST.expectedFragments.length}`);
      expect(matches).toBeGreaterThanOrEqual(MANIFEST.minimumMatches);
    });
  });

  test('downloads, activates, and deletes every vision tier without reloading', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const steps = new StepTracker(page);
    let documentLoads = 0;
    page.on('domcontentloaded', () => {
      documentLoads += 1;
      steps.log(`document load #${documentLoads}: ${page.url()}`);
    });

    await steps.run('open See pack manager', 15_000, async () => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'See' }).click();
      await page.getByRole('tab', { name: 'Photo' }).click();
      await page.getByRole('button', { name: 'Language packs' }).click();
    });

    for (const tier of ['Essential', 'Standard', 'Live'] as const) {
      await steps.run(`download ${tier} pack`, 30_000, async () => {
        const card = page.locator('.vision-pack-card').filter({ hasText: tier });
        await card.getByRole('button', { name: `Download ${tier} pack` }).click();
        await expect(
          card.getByRole('button', { name: 'Repair / redownload' }),
        ).toBeVisible({ timeout: 25_000 });
        await expect(card.getByText('Ready').first()).toBeVisible();
      });
    }

    await steps.run('verify no document reload occurred', 5_000, async () => {
      expect(documentLoads).toBe(1);
      await expect(page.getByRole('heading', { name: 'See' })).toBeVisible();
    });

    for (const tier of ['Essential', 'Standard', 'Live'] as const) {
      await steps.run(`delete ${tier} pack`, 10_000, async () => {
        const card = page.locator('.vision-pack-card').filter({ hasText: tier });
        await card.getByRole('button', { name: 'Delete pack' }).click();
        await expect(
          card.getByRole('button', { name: `Download ${tier} pack` }),
        ).toBeVisible({ timeout: 8_000 });
      });
    }
  });
});
