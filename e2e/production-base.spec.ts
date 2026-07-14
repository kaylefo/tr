import { expect, test } from '@playwright/test';

test('GitHub Pages build keeps all PWA and pack assets under /tr/', async ({
  page,
  request,
}) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      runtimeErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem('jp-first-use-seen', '1');
  });

  const response = await page.goto('./', { waitUntil: 'domcontentloaded' });
  expect(response?.ok()).toBe(true);
  await expect(
    page.getByRole('heading', { name: 'Convert' }),
    runtimeErrors.join(' | '),
  ).toBeVisible();

  const manifestHref = await page
    .locator('link[rel="manifest"]')
    .getAttribute('href');
  expect(manifestHref).toBe('/tr/manifest.webmanifest');

  const manifestResponse = await request.get(
    'http://127.0.0.1:4174/tr/manifest.webmanifest',
  );
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.start_url).toBe('/tr/');
  expect(manifest.scope).toBe('/tr/');
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: '/tr/icons/icon-192.png' }),
    ]),
  );

  for (const asset of [
    'icons/icon-32.png',
    'tesseract/worker.min.js',
    'tesseract/jpn.traineddata',
    'tesseract/jpn_vert.traineddata',
    'tesseract/best/jpn.traineddata',
  ]) {
    const assetResponse = await request.get(`http://127.0.0.1:4174/tr/${asset}`);
    expect(assetResponse.ok(), asset).toBe(true);
  }
});
