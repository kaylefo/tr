import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'production-base.spec.ts',
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174/tr/',
    trace: 'on-first-retry',
  },
  webServer: {
    command:
      'GITHUB_PAGES=true npm run build && npm run preview -- --host 127.0.0.1 --port 4174 --base /tr/',
    url: 'http://127.0.0.1:4174/tr/',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium-pages',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
