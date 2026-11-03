import { defineConfig, devices } from '@playwright/test'

/**
 * The PLUGINS-FLAG-ON browser suite (P5).
 *
 * The default playwright.config.ts keeps CANVIX_PLUGINS unset (its
 * specs assert the flag-off behavior: 503s, hidden UI, zero runtime
 * bytes). This config boots a SECOND dev server with the flag on,
 * on a separate port, and runs tests/e2e-plugins — the Word Cloud
 * acceptance suite for the v0.13 plugin system MVP.
 *
 *   npx playwright test -c playwright.plugins.config.ts
 *
 * Requires a reachable DATABASE_URL (same as the default suite).
 */
export default defineConfig({
  testDir: './tests/e2e-plugins',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        // NOT `npm run dev` — that script pipes through tee and pins
        // the port; invoke next directly with the plugins flag set
        command: 'npx next dev -p 3100',
        url: 'http://localhost:3100',
        timeout: 180_000,
        reuseExistingServer: true,
        stdout: 'ignore',
        env: { CANVIX_PLUGINS: '1' },
      },
})
