import { test, expect } from '@playwright/test'

/**
 * H3 (v0.12.1): the security-header baseline is served on every
 * route class — landing/editor pages, read APIs, the health probe —
 * from the single source of truth in next.config.ts `headers()`.
 * These assertions are the “verified” in the epic's acceptance
 * criteria; they run against `next dev` (CI) but the header set is
 * static, so production builds serve byte-identical values.
 */

// One representative URL per route class.
const ROUTE_CLASSES = [
  { label: 'landing page', url: '/' },
  { label: 'design deep-link page', url: '/design/nonexistent-id' },
  { label: 'read API (templates)', url: '/api/templates' },
  { label: 'read API (designs list)', url: '/api/designs' },
  { label: 'health probe', url: '/api/health' },
] as const

for (const route of ROUTE_CLASSES) {
  test(`security headers on ${route.label}`, async ({ request }) => {
    const res = await request.get(route.url)
    // the header contract must hold whatever the body says — even a
    // 404/503 from the route itself carries the baseline
    const h = res.headers()

    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(h['x-frame-options']).toBe('SAMEORIGIN')
    expect(h['strict-transport-security']).toBe('max-age=15552000; includeSubDomains')
    expect(h['permissions-policy']).toBe(
      'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    )
  })
}

test('CSP report-only baseline carries the documented policy', async ({ request }) => {
  const res = await request.get('/')
  const csp = res.headers()['content-security-policy-report-only']

  // report-only, never enforcing, until the review week is done
  expect(res.headers()['content-security-policy']).toBeUndefined()
  expect(csp).toBeDefined()

  // the app-need allowlist, directive by directive
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain('script-src')
  expect(csp).toContain('https://fonts.googleapis.com') // Google Fonts css
  expect(csp).toContain('https://fonts.gstatic.com') // Google Fonts files
  expect(csp).toContain('img-src')
  expect(csp).toContain('worker-src')
  expect(csp).toContain("frame-ancestors 'self'")
  expect(csp).toContain("object-src 'none'")
  expect(csp).toContain("base-uri 'self'")

  // the frame-src carve-out for embed cards is TLS-only
  expect(csp).toContain('frame-src https:')
})

test('static assets inherit the baseline too', async ({ request }) => {
  const res = await request.get('/logo.svg')
  expect(res.headers()['x-content-type-options']).toBe('nosniff')
  expect(res.headers()['x-frame-options']).toBe('SAMEORIGIN')
})
