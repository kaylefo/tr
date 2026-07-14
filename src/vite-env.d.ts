/// <reference types="@webgpu/types" />
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __BUILD_ID__: string;

interface JapanPocketE2EHooks {
  mockTranslate?: boolean;
  translations?: Record<string, string>;
}

interface Window {
  __JP_E2E__?: JapanPocketE2EHooks;
}
