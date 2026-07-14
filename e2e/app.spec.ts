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

  test('appearance setting works', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('offline shell reload', async ({ page, context }) => {
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('#convert-heading', { state: 'visible' });
    await expect(page.getByRole('heading', { name: 'Convert' })).toBeVisible();
  });
});

// Downloads the real on-device model (~80MB) once, then proves translation keeps
// working after an OFFLINE reload — the exact regression this change fixes.
test.describe('Japan Pocket · offline translation', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('jp-first-use-seen', '1');
    });
  });

  test('translates offline after reload', async ({ page, context }) => {
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

    // Go fully offline and restart the app: a fresh worker must re-load the
    // cached model without any network access.
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
