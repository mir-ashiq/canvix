import { defineConfig, devices } from '@playwright/test'

/**
 * Browser smoke tests for Canvix.
 *
 * Run:            npx playwright test
 * Against a URL:  BASE_URL=http://localhost:3000 npx playwright test
 *
 * By default Playwright boots `npm run dev` itself (needs a reachable
 * DATABASE_URL — see README → Local development). Point BASE_URL at an
 * already-running server to reuse it instead.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        timeout: 180_000,
        reuseExistingServer: true,
        stdout: 'ignore',
      },
})
