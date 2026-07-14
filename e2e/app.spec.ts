import { test, expect, type Page } from '@playwright/test';

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

test.describe('Japan Pocket', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('jp-first-use-seen', '1');
      window.__JP_E2E__ = {
        mockTranslate: true,
        mockPackDownload: true,
        translations: {
          こんにちは: 'Hello',
        },
      };
      localStorage.setItem(
        'jp-rate-emergency',
        JSON.stringify({
          id: 'current',
          baseCurrency: 'JPY',
          quoteCurrency: 'USD',
          rate: 0.00617,
          providerId: 'test',
          providerLabel: 'Test',
          providerSourceDate: '2026-07-13',
          fetchedAt: Date.now(),
          freshnessStatus: 'fresh',
        }),
      );
    });
    await mockRateApis(page);
    await page.goto('/');
    await page.waitForSelector('#convert-heading', { state: 'visible' });
  });

  test('launches converter', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Convert' })).toBeVisible();
    await expect(page.getByLabel('Amount in Japanese Yen')).toBeVisible();
  });

  test('converts JPY input', async ({ page }) => {
    await expect(page.getByText('Latest rate').or(page.getByText('Saved rate'))).toBeVisible();
    await page.getByLabel('Amount in Japanese Yen').fill('1000');
    await expect(page.getByLabel('Amount in US Dollars')).toHaveValue('6.17');
  });

  test('swap direction and quick amounts', async ({ page }) => {
    await page.getByRole('button', { name: 'Swap conversion direction' }).click();
    await page.getByRole('group', { name: 'Quick yen amounts' }).getByRole('button').first().click();
    await expect(page.getByLabel('Amount in Japanese Yen')).not.toHaveValue('');
  });

  test('navigates to see tab', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'See' }).click();
    await expect(page.getByRole('heading', { name: 'See' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Live' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Language packs' })).toBeVisible();
  });

  test('navigates to translate and shows pack UI', async ({ page }) => {
    await page.getByRole('button', { name: 'Translate' }).click();
    await expect(page.getByRole('heading', { name: 'Translate' })).toBeVisible();
    await expect(page.getByText('Offline Translation Pack')).toBeVisible();
  });

  test('downloads translation pack, translates, and persists history', async ({
    page,
  }) => {
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Translate' }).click();
    await page.getByRole('button', { name: 'Download offline pack' }).click();
    await expect(page.getByText('Offline translation ready')).toBeVisible();

    await page.getByLabel('Japanese text to translate').fill('こんにちは');
    await expect(page.locator('.translate-result__text')).toHaveText('Hello');

    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.getByText('こんにちは')).toBeVisible();
    await expect(page.getByText('Hello')).toBeVisible();
  });

  test('persists settings across reload', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Appearance').getByRole('radio', { name: 'Dark' }).click();
    await page.getByText('Default direction').locator('..').getByRole('combobox').selectOption(
      'USD_TO_JPY',
    );
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(
      page.getByText('Default direction').locator('..').getByRole('combobox'),
    ).toHaveValue('USD_TO_JPY');
    await page.reload();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(
      page.getByText('Default direction').locator('..').getByRole('combobox'),
    ).toHaveValue('USD_TO_JPY');
  });

  test('appearance setting works', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('offline shell reload', async ({ page, context }) => {
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready;
      }
    });
    if (!(await page.evaluate(() => Boolean(navigator.serviceWorker?.controller)))) {
      await page.reload();
      await page.waitForSelector('#convert-heading', { state: 'visible' });
    }
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('#convert-heading', { state: 'visible' });
    await expect(page.getByRole('heading', { name: 'Convert' })).toBeVisible();
  });
});

test.describe('Japan Pocket · offline translation', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('jp-first-use-seen', '1');
    });
  });

  test('translates offline after reload', async ({ page, context }) => {
    test.skip(
      !process.env.FULL_MODEL_E2E,
      'Real 80 MB model download runs only in the explicit full-model suite',
    );
    test.setTimeout(300_000);
    page.on('dialog', (dialog) => void dialog.accept());

    await page.goto('/');
    await page.getByRole('button', { name: 'Translate' }).click();
    await expect(page.getByRole('heading', { name: 'Translate' })).toBeVisible();

    await page.getByRole('button', { name: 'Download offline pack' }).click();
    await expect(
      page.locator('.offline-pack').getByText('Offline translation ready'),
    ).toBeVisible({ timeout: 240_000 });

    const source = page.getByLabel('Japanese text to translate');
    const result = page.locator('.translate-result__text');

    await source.fill('これはいくらですか？');
    await expect(result).not.toHaveText('', { timeout: 60_000 });
    const online = (await result.textContent())?.trim() ?? '';
    expect(online.length).toBeGreaterThan(1);

    await context.setOffline(true);
    await page.reload();
    await page.getByRole('button', { name: 'Translate' }).click();
    await expect(page.getByRole('heading', { name: 'Translate' })).toBeVisible();
    await expect(
      page.locator('.offline-pack').getByText('Offline translation ready'),
    ).toBeVisible({ timeout: 60_000 });

    const source2 = page.getByLabel('Japanese text to translate');
    const result2 = page.locator('.translate-result__text');
    await source2.fill('ありがとうございます');
    await expect(result2).not.toHaveText('', { timeout: 60_000 });
    const offline = (await result2.textContent())?.trim() ?? '';
    expect(offline.length).toBeGreaterThan(1);
    expect(offline).not.toContain('Download the offline pack');
  });
});
