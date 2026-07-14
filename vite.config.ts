import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

function resolveBuildId(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/tr/' : './',
  define: {
    __BUILD_ID__: JSON.stringify(resolveBuildId()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: false,
      workbox: {
        maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@fawazahmed0\/currency-api@/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'jp-rate-fawaz',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 4, maxAgeSeconds: 86400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/latest\.currency-api\.pages\.dev\/v1\/currencies\/jpy/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'jp-rate-mirror',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 4, maxAgeSeconds: 86400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/api\.frankfurter\.dev\/v1\/latest/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'jp-rate-frankfurter',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 4, maxAgeSeconds: 86400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/tessdata\.projectnaptha\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'jp-tessdata-fast-v1',
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/gh\/tesseract-ocr\/tessdata_best@/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'jp-tessdata-best-v1',
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/huggingface\.co\/Xenova\/opus-mt-ja-en\/resolve\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'jp-model-ja-en-v1',
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          storage: ['idb', 'decimal.js'],
        },
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
