import { defineConfig, devices } from '@playwright/test'

/**
 * The STOCK-VIDEO-PROVIDER-ON browser suite (v0.15 R6).
 *
 * The default playwright.config.ts keeps the provider keys unset
 * (its spec asserts the F2b gate: hidden rail, 503 NO_PROVIDER).
 * This config boots a SECOND dev server with a (fake) Pexels key
 * pointed at a local mock provider, on separate ports, and runs
 * tests/e2e-stock-video — the acceptance suite: search → insert →
 * durable attribution.
 *
 *   npx playwright test -c playwright.stockvideo.config.ts
 *
 * Requires a reachable DATABASE_URL (same as the default suite).
 */
export default defineConfig({
  testDir: './tests/e2e-stock-video',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3200',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.BASE_URL
    ? undefined
    : [
        {
          // the mock Pexels API: /videos/search + real mp4 renditions
          command: 'node tests/stock-video/mock-provider.mjs',
          url: 'http://127.0.0.1:3210/healthz',
          timeout: 30_000,
          reuseExistingServer: true,
          stdout: 'ignore',
        },
        {
          // NOT `npm run dev` — that script pipes through tee and pins
          // the port; invoke next directly with the provider keyed to
          // the mock (the plugins-config precedent)
          command: 'npx next dev -p 3200',
          url: 'http://localhost:3200',
          timeout: 180_000,
          reuseExistingServer: true,
          stdout: 'ignore',
          env: {
            PEXELS_API_KEY: 'ci-stock-video-key',
            PEXELS_API_BASE: 'http://127.0.0.1:3210',
          },
        },
      ],
})
